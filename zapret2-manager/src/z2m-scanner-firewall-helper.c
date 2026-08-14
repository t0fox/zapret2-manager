#include <errno.h>
#include <fcntl.h>
#include <arpa/inet.h>
#include <linux/netfilter.h>
#include <json-c/json.h>
#include <linux/netfilter/nf_tables.h>
#include <linux/netfilter/nfnetlink.h>
#include <linux/netlink.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define REQUEST_MAX 4096U
#define RESPONSE_MAX 4096U
#define NETLINK_TIMEOUT_MS 5000
#define USERDATA_MAX 256U
#define TABLE_NAME_MAX 63U
#define OPERATION_ID_MAX 129U
#define NONCE_MAX 65U
#define CHAIN_NAME_MAX 64U
#define PROFILE_MAX 17U
#define NETLINK_BUFFER 8192U
#define NFT_TABLE_F_OWNER 0x2U
#define QUEUE_MIN 300U
#define QUEUE_MAX 399U

struct owner_state {
	int fd;
	uint32_t portid;
	bool table_created;
	bool rules_prepared;
	bool rules_enabled;
	char table_name[TABLE_NAME_MAX];
	char chain_name[CHAIN_NAME_MAX];
	char operation_id[OPERATION_ID_MAX];
	char nonce[NONCE_MAX];
	uint32_t generation;
	uint16_t queue;
	char profile[PROFILE_MAX];
};

static volatile sig_atomic_t stopping;

enum transaction_result {
	TRANSACTION_OK,
	TRANSACTION_OPERATION_ERROR,
	TRANSACTION_FATAL
};

static void stop_handler(int signal_number)
{
	(void)signal_number;
	stopping = 1;
}

static size_t nla_align(size_t length)
{
	return (length + 3U) & ~3U;
}

static bool append_attr(unsigned char *buffer, size_t capacity, size_t *used,
	uint16_t type, const void *value, size_t value_length)
{
	size_t aligned_length;
	struct nlattr *attribute;

	if (!buffer || !used || !value || value_length > UINT16_MAX - sizeof(struct nlattr))
		return false;
	if (*used > capacity || nla_align(sizeof(struct nlattr) + value_length) > capacity - *used)
		return false;
	aligned_length = nla_align(sizeof(struct nlattr) + value_length);
	attribute = (struct nlattr *)(buffer + *used);
	attribute->nla_len = (uint16_t)(sizeof(struct nlattr) + value_length);
	attribute->nla_type = type;
	memcpy((unsigned char *)attribute + sizeof(*attribute), value, value_length);
	memset((unsigned char *)attribute + attribute->nla_len, 0,
		aligned_length - attribute->nla_len);
	*used += aligned_length;
	return true;
}

static size_t begin_nested(unsigned char *buffer, size_t capacity, size_t *used, uint16_t type)
{
	size_t offset = used ? *used : capacity + 1U;
	if (!append_attr(buffer, capacity, used, type | NLA_F_NESTED, "", 0U))
		return capacity + 1U;
	return offset;
}

static bool finish_nested(unsigned char *buffer, size_t used, size_t offset)
{
	struct nlattr *attribute;
	if (!buffer || offset >= used)
		return false;
	attribute = (struct nlattr *)(buffer + offset);
	attribute->nla_len = (uint16_t)(used - offset);
	return true;
}

static bool append_u32(unsigned char *buffer, size_t capacity, size_t *used,
	uint16_t type, uint32_t value)
{
	uint32_t network_value = htonl(value);
	return append_attr(buffer, capacity, used, type, &network_value, sizeof(network_value));
}

static bool append_u16(unsigned char *buffer, size_t capacity, size_t *used,
	uint16_t type, uint16_t value)
{
	uint16_t network_value = htons(value);
	return append_attr(buffer, capacity, used, type, &network_value, sizeof(network_value));
}

static bool valid_id(const char *value, size_t maximum)
{
	if (!value || value[0] == '\0' || strlen(value) >= maximum)
		return false;
	for (; *value; value++) {
		if (!(('A' <= *value && *value <= 'Z') || ('a' <= *value && *value <= 'z') ||
			('0' <= *value && *value <= '9') || strchr("._:-", *value) != NULL))
			return false;
	}
	return true;
}

static bool valid_hex(const char *value, size_t length)
{
	if (!value)
		return false;
	for (size_t index = 0; index < length; index++) {
		if (!(('0' <= value[index] && value[index] <= '9') ||
			('a' <= value[index] && value[index] <= 'f')))
			return false;
	}
	return true;
}

static bool valid_table_name(const char *value)
{
	return value && strlen(value) == 62U && strncmp(value, "z2m_sc_", 7) == 0 &&
		value[15] == '_' && value[24] == '_' && value[29] == '_' &&
		valid_hex(value + 7, 8) && valid_hex(value + 16, 8) &&
		valid_hex(value + 25, 4) && valid_hex(value + 30, 32);
}

static bool valid_profile(const char *value)
{
	return value && (strcmp(value, "tcp_https") == 0 || strcmp(value, "tcp_http") == 0 ||
		strcmp(value, "udp_443") == 0);
}

static bool valid_queue(uint32_t value)
{
	return value >= QUEUE_MIN && value <= QUEUE_MAX;
}

static bool make_chain_name(char *output, size_t capacity, uint32_t generation, const char *nonce)
{
	int length;
	if (!output || !nonce || !valid_hex(nonce, 64U))
		return false;
	length = snprintf(output, capacity, "z2m_%04x_%.*s", generation & 0xffffU, 8, nonce);
	return length > 0 && (size_t)length < capacity;
}

static bool emit_json(json_object *response)
{
	const char *text = json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN);
	if (!text || strlen(text) + 1U > RESPONSE_MAX)
		return false;
	puts(text);
	fflush(stdout);
	return true;
}

static void emit_error(const char *request_id, const char *code, const char *stage)
{
	json_object *response = json_object_new_object();
	json_object *error = json_object_new_object();
	json_object_object_add(response, "protocolVersion", json_object_new_int(2));
	json_object_object_add(response, "requestId", request_id ?
		json_object_new_string(request_id) : json_object_new_null());
	json_object_object_add(response, "ok", json_object_new_boolean(false));
	json_object_object_add(error, "code", json_object_new_string(code));
	json_object_object_add(error, "message", json_object_new_string(stage));
	json_object_object_add(error, "retryable", json_object_new_boolean(false));
	json_object_object_add(error, "committed", json_object_new_boolean(false));
	json_object_object_add(error, "durability", json_object_new_string("unchanged"));
	json_object_object_add(error, "stage", json_object_new_string(stage));
	json_object_object_add(response, "error", error);
	(void)emit_json(response);
	json_object_put(response);
}

static void emit_state(const char *request_id, const char *operation,
	const char *table_name, const struct owner_state *state)
{
	json_object *response = json_object_new_object();
	json_object *data = json_object_new_object();
	json_object *evidence = json_object_new_object();
	json_object_object_add(response, "protocolVersion", json_object_new_int(2));
	json_object_object_add(response, "requestId", json_object_new_string(request_id));
	json_object_object_add(response, "ok", json_object_new_boolean(true));
	if (strcmp(operation, "ownership_create") == 0)
		json_object_object_add(data, "created", json_object_new_boolean(true));
	else if (strcmp(operation, "ownership_ready") == 0)
		json_object_object_add(data, "ready", json_object_new_boolean(true));
	else if (strcmp(operation, "rules_prepare") == 0)
		json_object_object_add(data, "prepared", json_object_new_boolean(true));
	else if (strcmp(operation, "rules_enable") == 0)
		json_object_object_add(data, "enabled", json_object_new_boolean(true));
	else if (strcmp(operation, "rules_disable") == 0)
		json_object_object_add(data, "disabled", json_object_new_boolean(true));
	else if (strcmp(operation, "ownership_delete") == 0)
		json_object_object_add(data, "deleted", json_object_new_boolean(true));
	else {
		json_object_object_add(data, "exists", json_object_new_boolean(state->table_created));
		json_object_object_add(data, "owned", json_object_new_boolean(state->table_created));
	}
	json_object_object_add(data, "tableName", json_object_new_string(table_name));
	if (state->rules_prepared) {
		json_object_object_add(data, "chainName", json_object_new_string(state->chain_name));
		json_object_object_add(data, "generation", json_object_new_int((int)state->generation));
		json_object_object_add(data, "queue", json_object_new_int((int)state->queue));
		json_object_object_add(data, "profile", json_object_new_string(state->profile));
		json_object_object_add(data, "rulesPrepared", json_object_new_boolean(true));
		json_object_object_add(data, "rulesEnabled", json_object_new_boolean(state->rules_enabled));
	}
	json_object_object_add(evidence, "tableName", json_object_new_string(table_name));
	json_object_object_add(evidence, "operationId", json_object_new_string(state->operation_id));
	json_object_object_add(evidence, "nonce", json_object_new_string(state->nonce));
	json_object_object_add(evidence, "ownerFlagRequested", json_object_new_boolean(true));
	json_object_object_add(evidence, "kernelReadBack", json_object_new_boolean(false));
	if (state->rules_prepared) {
		json_object_object_add(evidence, "chainName", json_object_new_string(state->chain_name));
		json_object_object_add(evidence, "generation", json_object_new_int((int)state->generation));
		json_object_object_add(evidence, "queue", json_object_new_int((int)state->queue));
		json_object_object_add(evidence, "profile", json_object_new_string(state->profile));
		json_object_object_add(evidence, "ruleGenerationVerified", json_object_new_boolean(true));
	}
	json_object_object_add(data, "evidence", evidence);
	json_object_object_add(response, "data", data);
	(void)emit_json(response);
	json_object_put(response);
}

static bool exact_fields(json_object *object, const char *const *names, size_t count)
{
	size_t fields = 0;
	json_object_object_foreach(object, key, value) {
		bool known = false;
		(void)value;
		for (size_t index = 0; index < count; index++) {
			if (strcmp(key, names[index]) == 0) {
				known = true;
				break;
			}
		}
		if (!known)
			return false;
		fields++;
	}
	return fields == count;
}

static bool string_field(json_object *object, const char *name, char *output, size_t capacity)
{
	json_object *value;
	const char *text;
	int length;

	if (!json_object_object_get_ex(object, name, &value) ||
		!json_object_is_type(value, json_type_string))
		return false;
	text = json_object_get_string(value);
	length = json_object_get_string_len(value);
	if (!text || length < 1 || (size_t)length >= capacity)
		return false;
	memcpy(output, text, (size_t)length + 1U);
	return true;
}

static bool integer_field(json_object *object, const char *name, int64_t *output)
{
	json_object *value;
	if (!json_object_object_get_ex(object, name, &value) ||
		!json_object_is_type(value, json_type_int))
		return false;
	*output = json_object_get_int64(value);
	return true;
}

static void skip_json_space(const char **cursor)
{
	while (**cursor == ' ' || **cursor == '\t' || **cursor == '\r' || **cursor == '\n')
		(*cursor)++;
}

static bool scan_json_value(const char **cursor);

static bool scan_json_string(const char **cursor)
{
	const char *text = *cursor;
	if (*text++ != '"')
		return false;
	while (*text && *text != '"') {
		if ((unsigned char)*text < 0x20U)
			return false;
		if (*text == '\\') {
			if (text[1] == '\0')
				return false;
			text++;
		}
		text++;
	}
	if (*text != '"')
		return false;
	*cursor = text + 1;
	return true;
}

static bool scan_json_object(const char **cursor)
{
	const char *keys[32] = { 0 };
	size_t key_lengths[32] = { 0 };
	size_t key_count = 0;
	const char *key_start;
	if (*(*cursor)++ != '{')
		return false;
	skip_json_space(cursor);
	if (**cursor == '}') {
		(*cursor)++;
		return true;
	}
	for (;;) {
		if (key_count == 32U || **cursor != '"')
			return false;
		key_start = *cursor + 1;
		if (!scan_json_string(cursor))
			return false;
		key_lengths[key_count] = (size_t)(*cursor - key_start - 1U);
		for (size_t index = 0; index < key_count; index++) {
			if (key_lengths[index] == key_lengths[key_count] &&
				memcmp(keys[index], key_start, key_lengths[key_count]) == 0)
				return false;
		}
		keys[key_count++] = key_start;
		skip_json_space(cursor);
		if (*(*cursor)++ != ':')
			return false;
		skip_json_space(cursor);
		if (!scan_json_value(cursor))
			return false;
		skip_json_space(cursor);
		if (**cursor == '}') {
			(*cursor)++;
			return true;
		}
		if (*(*cursor)++ != ',')
			return false;
		skip_json_space(cursor);
	}
}

static bool scan_json_array(const char **cursor)
{
	if (*(*cursor)++ != '[')
		return false;
	skip_json_space(cursor);
	if (**cursor == ']') {
		(*cursor)++;
		return true;
	}
	for (;;) {
		if (!scan_json_value(cursor))
			return false;
		skip_json_space(cursor);
		if (**cursor == ']') {
			(*cursor)++;
			return true;
		}
		if (*(*cursor)++ != ',')
			return false;
		skip_json_space(cursor);
	}
}

static bool scan_json_value(const char **cursor)
{
	skip_json_space(cursor);
	if (**cursor == '"')
		return scan_json_string(cursor);
	if (**cursor == '{')
		return scan_json_object(cursor);
	if (**cursor == '[')
		return scan_json_array(cursor);
	if (strncmp(*cursor, "true", 4) == 0) {
		*cursor += 4;
		return true;
	}
	if (strncmp(*cursor, "false", 5) == 0) {
		*cursor += 5;
		return true;
	}
	if (strncmp(*cursor, "null", 4) == 0) {
		*cursor += 4;
		return true;
	}
	if (**cursor == '-' || (**cursor >= '0' && **cursor <= '9')) {
		while ((**cursor >= '0' && **cursor <= '9') || strchr("+-.eE", **cursor) != NULL)
			(*cursor)++;
		return true;
	}
	return false;
}

static bool valid_json_document(const char *text)
{
	const char *cursor = text;
	if (!scan_json_value(&cursor))
		return false;
	skip_json_space(&cursor);
	return *cursor == '\0';
}

enum read_result {
	READ_END,
	READ_LINE,
	READ_TOO_BIG,
	READ_MALFORMED
};

static enum read_result read_request_line(char *line, size_t capacity)
{
	size_t used = 0;
	int character;
	bool malformed = false;

	for (;;) {
		character = fgetc(stdin);
		if (character == EOF)
			return used == 0U ? READ_END : (malformed ? READ_MALFORMED : READ_LINE);
		if (character == '\0')
			malformed = true;
		if (used >= REQUEST_MAX || used + 1U >= capacity) {
			while (character != '\n' && character != EOF)
				character = fgetc(stdin);
			return READ_TOO_BIG;
		}
		line[used++] = (char)character;
		if (character == '\n') {
			line[used] = '\0';
			return malformed ? READ_MALFORMED : READ_LINE;
		}
	}
}

static bool parse_line(char *line, char *request_id, size_t request_id_capacity,
	char *operation, size_t operation_capacity, char *table_name,
	size_t table_name_capacity, char *operation_id, size_t operation_id_capacity,
	char *nonce, size_t nonce_capacity, uint32_t *generation, uint16_t *queue,
	char *profile, size_t profile_capacity)
{
	static const char *const fields[] = { "protocolVersion", "requestId", "operation", "arguments" };
	static const char *const ownership_argument_fields[] = { "tableName", "operationId", "nonce" };
	static const char *const rules_argument_fields[] = { "tableName", "operationId", "nonce", "generation", "queue", "profile" };
	json_tokener *tokener;
	json_object *document = NULL;
	json_object *value, *arguments;
	bool valid = false;
	bool rules_operation = false;
	int64_t generation_value = -1, queue_value = -1;
	size_t length = strlen(line);
	request_id[0] = '\0';

	if (length == 0 || length > REQUEST_MAX || line[length - 1] != '\n')
		return false;
	line[length - 1] = '\0';
	if (length > 1 && line[length - 2] == '\r')
		line[length - 2] = '\0';
	tokener = json_tokener_new();
	if (!tokener)
		return false;
	json_tokener_set_flags(tokener, JSON_TOKENER_STRICT);
	document = json_tokener_parse_ex(tokener, line, (int)strlen(line));
	if (document && json_object_is_type(document, json_type_object) &&
		json_object_object_get_ex(document, "requestId", &value) &&
		json_object_is_type(value, json_type_string) &&
		string_field(document, "requestId", request_id, request_id_capacity) &&
		valid_id(request_id, request_id_capacity)) {
		/* The envelope identity is retained before operation validation. */
	}
	if (!valid_json_document(line)) {
		if (document)
			json_object_put(document);
		json_tokener_free(tokener);
		return false;
	}
	if (document && json_object_is_type(document, json_type_object) &&
		exact_fields(document, fields, sizeof(fields) / sizeof(fields[0])) &&
		json_object_object_get_ex(document, "protocolVersion", &value) &&
		json_object_is_type(value, json_type_int) && json_object_get_int(value) == 2 &&
		string_field(document, "requestId", request_id, request_id_capacity) &&
		string_field(document, "operation", operation, operation_capacity) &&
		json_object_object_get_ex(document, "arguments", &arguments) &&
		json_object_is_type(arguments, json_type_object) &&
		(rules_operation = strcmp(operation, "rules_prepare") == 0 ||
			strcmp(operation, "rules_enable") == 0 ||
			strcmp(operation, "rules_disable") == 0,
		 exact_fields(arguments, rules_operation ? rules_argument_fields : ownership_argument_fields,
			rules_operation ? sizeof(rules_argument_fields) / sizeof(rules_argument_fields[0]) :
			 sizeof(ownership_argument_fields) / sizeof(ownership_argument_fields[0]))) &&
		string_field(arguments, "tableName", table_name, table_name_capacity) &&
		string_field(arguments, "operationId", operation_id, operation_id_capacity) &&
		string_field(arguments, "nonce", nonce, nonce_capacity) &&
		(!rules_operation || (integer_field(arguments, "generation", &generation_value) &&
			integer_field(arguments, "queue", &queue_value) &&
			string_field(arguments, "profile", profile, profile_capacity))) &&
		json_object_object_get_ex(document, "operation", &value)) {
		valid = valid_id(request_id, request_id_capacity) &&
			valid_id(operation_id, operation_id_capacity) &&
			valid_id(nonce, nonce_capacity) &&
			strlen(nonce) == 64U && valid_hex(nonce, 64U) &&
			valid_table_name(table_name) &&
			(strcmp(operation, "ownership_create") == 0 ||
			 strcmp(operation, "ownership_ready") == 0 ||
			 strcmp(operation, "ownership_delete") == 0 ||
			 strcmp(operation, "ownership_status") == 0 ||
			 strcmp(operation, "rules_prepare") == 0 ||
			 strcmp(operation, "rules_enable") == 0 ||
			 strcmp(operation, "rules_disable") == 0) &&
			(!rules_operation || (generation_value >= 0 && generation_value <= 65535 &&
				queue_value >= 0 && valid_queue((uint32_t)queue_value) && valid_profile(profile))) &&
			strcmp(json_object_get_string(value), operation) == 0;
	}
	if (valid && rules_operation) {
		*generation = (uint32_t)generation_value;
		*queue = (uint16_t)queue_value;
	}
	if (document)
		json_object_put(document);
	json_tokener_free(tokener);
	return valid;
}

static enum transaction_result send_batch(struct owner_state *state, unsigned char *request,
	size_t used, uint32_t sequence);
static struct nlmsghdr *append_message(unsigned char *buffer, size_t capacity, size_t *used,
	uint16_t type, uint16_t flags, uint32_t sequence, uint8_t family);
static bool append_batch_end(unsigned char *buffer, size_t capacity, size_t *used,
	uint32_t sequence);
static bool finish_message(unsigned char *buffer, size_t used, size_t offset);

static enum transaction_result netlink_transaction(struct owner_state *state, uint16_t message,
	const char *table_name, const char *userdata)
{
#ifdef Z2M_SCANNER_HELPER_TEST
	/* The protocol test binary has no kernel netfilter namespace. Keep the
	 * transport boundary deterministic while production still uses netlink. */
	(void)message;
	(void)table_name;
	(void)userdata;
	if (state->fd >= 0)
		return TRANSACTION_OK;
#endif
	unsigned char request[NETLINK_BUFFER] = { 0 };
	struct nlmsghdr *header;
	uint32_t flags = htonl(NFT_TABLE_F_OWNER);
	static uint32_t sequence = 1U;
	uint32_t expected_sequence = sequence++;
	size_t used = 0U, message_start;

	if (!append_message(request, sizeof(request), &used,
		NFNL_MSG_BATCH_BEGIN, NLM_F_REQUEST,
		expected_sequence, NFPROTO_UNSPEC))
		return TRANSACTION_FATAL;
	message_start = used;
	header = append_message(request, sizeof(request), &used,
		(uint16_t)((NFNL_SUBSYS_NFTABLES << 8) | message),
		NLM_F_REQUEST | NLM_F_ACK | (message == NFT_MSG_NEWTABLE ? NLM_F_CREATE | NLM_F_EXCL : 0),
		expected_sequence, NFPROTO_INET);
	if (!header || !append_attr(request, sizeof(request), &used, NFTA_TABLE_NAME,
		table_name, strlen(table_name) + 1U))
		return TRANSACTION_FATAL;
	if (message == NFT_MSG_NEWTABLE &&
		(!append_attr(request, sizeof(request), &used, NFTA_TABLE_FLAGS,
			&flags, sizeof(flags)) || !append_attr(request, sizeof(request), &used,
			NFTA_TABLE_USERDATA, userdata, strlen(userdata))))
		return TRANSACTION_FATAL;
	if (!finish_message(request, used, message_start) ||
		!append_batch_end(request, sizeof(request), &used, expected_sequence))
		return TRANSACTION_FATAL;
	return send_batch(state, request, used, expected_sequence);
}

static enum transaction_result send_batch(struct owner_state *state, unsigned char *request,
	size_t used, uint32_t sequence)
{
	unsigned char response[NETLINK_BUFFER];
	struct sockaddr_nl address = { .nl_family = AF_NETLINK };
	struct pollfd descriptor = { .fd = state->fd, .events = POLLIN };
	struct timespec started;
	int remaining = NETLINK_TIMEOUT_MS;

#ifdef Z2M_SCANNER_HELPER_TEST
	(void)request;
	(void)used;
	(void)sequence;
	if (state->fd >= 0)
		return TRANSACTION_OK;
#endif
	if (sendto(state->fd, request, used, 0, (struct sockaddr *)&address, sizeof(address)) < 0)
		return TRANSACTION_FATAL;
	if (clock_gettime(CLOCK_MONOTONIC, &started) < 0)
		return TRANSACTION_FATAL;
	for (;;) {
		struct timespec now;
		int elapsed, ready;
		ssize_t received;
		if (clock_gettime(CLOCK_MONOTONIC, &now) < 0)
			return TRANSACTION_FATAL;
		elapsed = (int)((now.tv_sec - started.tv_sec) * 1000L +
			(now.tv_nsec - started.tv_nsec) / 1000000L);
		remaining = NETLINK_TIMEOUT_MS - elapsed;
		if (remaining <= 0)
			return TRANSACTION_FATAL;
		ready = poll(&descriptor, 1, remaining);
		if (ready < 0 && errno == EINTR)
			continue;
		if (ready <= 0 || (descriptor.revents & (POLLERR | POLLHUP)))
			return TRANSACTION_FATAL;
		received = recv(state->fd, response, sizeof(response), MSG_DONTWAIT | MSG_TRUNC);
		if (received < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK))
			continue;
		if (received < (ssize_t)sizeof(struct nlmsghdr) || received > (ssize_t)sizeof(response))
			return TRANSACTION_FATAL;
		int bytes = (int)received;
		for (struct nlmsghdr *message_header = (struct nlmsghdr *)response;
			NLMSG_OK(message_header, bytes);
			message_header = NLMSG_NEXT(message_header, bytes)) {
			if (message_header->nlmsg_seq != sequence)
				continue;
			if (message_header->nlmsg_type != NLMSG_ERROR ||
				message_header->nlmsg_len < NLMSG_LENGTH(sizeof(struct nlmsgerr)))
				return TRANSACTION_FATAL;
			return ((struct nlmsgerr *)NLMSG_DATA(message_header))->error == 0
				? TRANSACTION_OK : TRANSACTION_OPERATION_ERROR;
		}
		if (bytes != 0)
			return TRANSACTION_FATAL;
	}
}

static struct nlmsghdr *append_message(unsigned char *buffer, size_t capacity, size_t *used,
	uint16_t type, uint16_t flags, uint32_t sequence, uint8_t family)
{
	struct nlmsghdr *header;
	struct nfgenmsg *generic;
	if (!buffer || !used || *used > capacity || capacity - *used < NLMSG_LENGTH(sizeof(*generic)))
		return NULL;
	header = (struct nlmsghdr *)(buffer + *used);
	header->nlmsg_len = NLMSG_LENGTH(sizeof(*generic));
	header->nlmsg_type = type;
	header->nlmsg_flags = flags;
	header->nlmsg_seq = sequence;
	header->nlmsg_pid = 0;
	generic = (struct nfgenmsg *)NLMSG_DATA(header);
	generic->nfgen_family = family;
	generic->version = NFNETLINK_V0;
	generic->res_id = (type == NFNL_MSG_BATCH_BEGIN || type == NFNL_MSG_BATCH_END)
		? htons(NFNL_SUBSYS_NFTABLES) : htons(0);
	*used += NLMSG_ALIGN(header->nlmsg_len);
	return header;
}

static bool finish_message(unsigned char *buffer, size_t used, size_t offset)
{
	struct nlmsghdr *header;
	if (!buffer || offset >= used || used - offset > UINT32_MAX)
		return false;
	header = (struct nlmsghdr *)(buffer + offset);
	header->nlmsg_len = (uint32_t)(used - offset);
	return true;
}

static bool append_batch_end(unsigned char *buffer, size_t capacity, size_t *used,
	uint32_t sequence)
{
	return append_message(buffer, capacity, used,
		NFNL_MSG_BATCH_END, NLM_F_REQUEST,
		sequence, NFPROTO_UNSPEC) != NULL;
}

static enum transaction_result install_chain(struct owner_state *state)
{
	unsigned char request[NETLINK_BUFFER] = { 0 };
	struct nlmsghdr *header;
	size_t used = 0, hook, message_start;
	uint32_t sequence = (uint32_t)time(NULL) ^ state->portid;
	char userdata[USERDATA_MAX];
	int length = snprintf(userdata, sizeof(userdata), "z2m-scanner-rules:%s:%u:%s:%s",
		state->operation_id, state->generation, state->nonce, state->profile);
	uint32_t hook_number = NF_INET_PRE_ROUTING, priority = 0;

	if (length < 1 || (size_t)length >= sizeof(userdata))
		return TRANSACTION_OPERATION_ERROR;
	header = append_message(request, sizeof(request), &used,
		NFNL_MSG_BATCH_BEGIN, NLM_F_REQUEST,
		sequence, NFPROTO_UNSPEC);
	if (!header)
		return TRANSACTION_FATAL;
	message_start = used;
	header = append_message(request, sizeof(request), &used,
		(uint16_t)((NFNL_SUBSYS_NFTABLES << 8) | NFT_MSG_NEWCHAIN),
		NLM_F_REQUEST | NLM_F_ACK | NLM_F_CREATE | NLM_F_EXCL, sequence, NFPROTO_INET);
	if (!header || !append_attr(request, sizeof(request), &used, NFTA_CHAIN_TABLE,
		state->table_name, strlen(state->table_name) + 1U) ||
		!append_attr(request, sizeof(request), &used, NFTA_CHAIN_NAME,
		state->chain_name, strlen(state->chain_name) + 1U) ||
		!append_attr(request, sizeof(request), &used, NFTA_CHAIN_TYPE, "filter", 7U) ||
		!append_attr(request, sizeof(request), &used, NFTA_CHAIN_USERDATA,
		userdata, strlen(userdata)))
		return TRANSACTION_FATAL;
	hook = begin_nested(request, sizeof(request), &used, NFTA_CHAIN_HOOK);
	if (hook >= sizeof(request) || !append_u32(request, sizeof(request), &used,
		NFTA_HOOK_HOOKNUM, hook_number) || !append_u32(request, sizeof(request), &used,
		NFTA_HOOK_PRIORITY, priority) || !finish_nested(request, used, hook) ||
		!finish_message(request, used, message_start) ||
		!append_batch_end(request, sizeof(request), &used, sequence))
		return TRANSACTION_FATAL;
	return send_batch(state, request, used, sequence);
}

static bool append_cmp(unsigned char *buffer, size_t capacity, size_t *used,
	const void *value, size_t value_length)
{
	size_t expression = begin_nested(buffer, capacity, used, NFTA_LIST_ELEM);
	size_t data;
	if (expression >= capacity || !append_attr(buffer, capacity, used, NFTA_EXPR_NAME,
		"cmp", 4U))
		return false;
	data = begin_nested(buffer, capacity, used, NFTA_EXPR_DATA);
	if (data >= capacity || !append_u32(buffer, capacity, used, NFTA_CMP_SREG, NFT_REG_1) ||
		!append_u32(buffer, capacity, used, NFTA_CMP_OP, NFT_CMP_EQ))
		return false;
	{
		size_t compare_data = begin_nested(buffer, capacity, used, NFTA_CMP_DATA);
		if (compare_data >= capacity || !append_attr(buffer, capacity, used, NFTA_DATA_VALUE,
			value, value_length) || !finish_nested(buffer, *used, compare_data))
			return false;
	}
	if (!finish_nested(buffer, *used, data) || !finish_nested(buffer, *used, expression))
		return false;
	return true;
}

static bool append_meta_cmp(unsigned char *buffer, size_t capacity, size_t *used,
	uint32_t key, const void *value, size_t value_length)
{
	size_t expression = begin_nested(buffer, capacity, used, NFTA_LIST_ELEM);
	size_t data;
	if (expression >= capacity || !append_attr(buffer, capacity, used, NFTA_EXPR_NAME,
		"meta", 5U))
		return false;
	data = begin_nested(buffer, capacity, used, NFTA_EXPR_DATA);
	if (data >= capacity || !append_u32(buffer, capacity, used, NFTA_META_KEY, key) ||
		!append_u32(buffer, capacity, used, NFTA_META_DREG, NFT_REG_1) ||
		!finish_nested(buffer, *used, data) || !finish_nested(buffer, *used, expression))
		return false;
	return append_cmp(buffer, capacity, used, value, value_length);
}

static bool append_payload_cmp(unsigned char *buffer, size_t capacity, size_t *used,
	uint16_t port)
{
	size_t expression = begin_nested(buffer, capacity, used, NFTA_LIST_ELEM);
	size_t data;
	uint16_t network_port = htons(port);
	if (expression >= capacity || !append_attr(buffer, capacity, used, NFTA_EXPR_NAME,
		"payload", 8U))
		return false;
	data = begin_nested(buffer, capacity, used, NFTA_EXPR_DATA);
	if (data >= capacity || !append_u32(buffer, capacity, used, NFTA_PAYLOAD_DREG, NFT_REG_1) ||
		!append_u32(buffer, capacity, used, NFTA_PAYLOAD_BASE, NFT_PAYLOAD_TRANSPORT_HEADER) ||
		!append_u32(buffer, capacity, used, NFTA_PAYLOAD_OFFSET, 2U) ||
		!append_u32(buffer, capacity, used, NFTA_PAYLOAD_LEN, 2U) ||
		!finish_nested(buffer, *used, data) || !finish_nested(buffer, *used, expression))
		return false;
	return append_cmp(buffer, capacity, used, &network_port, sizeof(network_port));
}

static bool append_queue_expression(unsigned char *buffer, size_t capacity, size_t *used,
	uint16_t queue)
{
	size_t expression = begin_nested(buffer, capacity, used, NFTA_LIST_ELEM);
	size_t data;
	if (expression >= capacity || !append_attr(buffer, capacity, used, NFTA_EXPR_NAME,
		"queue", 6U))
		return false;
	data = begin_nested(buffer, capacity, used, NFTA_EXPR_DATA);
	if (data >= capacity || !append_u16(buffer, capacity, used, NFTA_QUEUE_NUM, queue) ||
		!append_u16(buffer, capacity, used, NFTA_QUEUE_TOTAL, 1U) ||
		!finish_nested(buffer, *used, data) || !finish_nested(buffer, *used, expression))
		return false;
	return true;
}

static enum transaction_result install_rule(struct owner_state *state)
{
	unsigned char request[NETLINK_BUFFER] = { 0 };
	size_t used = 0, expressions, message_start;
	uint32_t sequence = (uint32_t)time(NULL) ^ state->portid ^ state->generation;
	uint8_t protocol = (strcmp(state->profile, "udp_443") == 0) ? IPPROTO_UDP : IPPROTO_TCP;
	uint16_t port = (strcmp(state->profile, "tcp_http") == 0) ? 80U : 443U;
	char userdata[USERDATA_MAX];
	int length = snprintf(userdata, sizeof(userdata), "z2m-scanner-rule:%s:%u:%s:%u",
		state->operation_id, state->generation, state->profile, state->queue);

	if (length < 1 || (size_t)length >= sizeof(userdata))
		return TRANSACTION_OPERATION_ERROR;
	if (!append_message(request, sizeof(request), &used,
		NFNL_MSG_BATCH_BEGIN, NLM_F_REQUEST,
		sequence, NFPROTO_UNSPEC))
		return TRANSACTION_FATAL;
	message_start = used;
	if (!append_message(request, sizeof(request), &used,
		(uint16_t)((NFNL_SUBSYS_NFTABLES << 8) | NFT_MSG_NEWRULE),
		NLM_F_REQUEST | NLM_F_ACK | NLM_F_CREATE | NLM_F_EXCL, sequence, NFPROTO_INET) ||
		!append_attr(request, sizeof(request), &used, NFTA_RULE_TABLE,
		state->table_name, strlen(state->table_name) + 1U) ||
		!append_attr(request, sizeof(request), &used, NFTA_RULE_CHAIN,
		state->chain_name, strlen(state->chain_name) + 1U) ||
		!append_attr(request, sizeof(request), &used, NFTA_RULE_USERDATA,
		userdata, strlen(userdata)))
		return TRANSACTION_FATAL;
	expressions = begin_nested(request, sizeof(request), &used, NFTA_RULE_EXPRESSIONS);
	if (expressions >= sizeof(request) || !append_meta_cmp(request, sizeof(request), &used,
		NFT_META_L4PROTO, &protocol, sizeof(protocol)) || !append_payload_cmp(request,
		sizeof(request), &used, port) || !append_queue_expression(request, sizeof(request),
		&used, state->queue) || !finish_nested(request, used, expressions) ||
		!finish_message(request, used, message_start) ||
		!append_batch_end(request, sizeof(request), &used, sequence))
		return TRANSACTION_FATAL;
	return send_batch(state, request, used, sequence);
}

static enum transaction_result delete_chain(struct owner_state *state)
{
	unsigned char request[NETLINK_BUFFER] = { 0 };
	size_t used = 0, message_start;
	uint32_t sequence = (uint32_t)time(NULL) ^ state->portid ^ state->generation ^ 0x40000000U;
	if (!append_message(request, sizeof(request), &used,
		NFNL_MSG_BATCH_BEGIN, NLM_F_REQUEST,
		sequence, NFPROTO_UNSPEC))
		return TRANSACTION_FATAL;
	message_start = used;
	if (!append_message(request, sizeof(request), &used,
		(uint16_t)((NFNL_SUBSYS_NFTABLES << 8) | NFT_MSG_DELCHAIN),
		NLM_F_REQUEST | NLM_F_ACK, sequence, NFPROTO_INET) ||
		!append_attr(request, sizeof(request), &used, NFTA_CHAIN_TABLE,
		state->table_name, strlen(state->table_name) + 1U) ||
		!append_attr(request, sizeof(request), &used, NFTA_CHAIN_NAME,
		state->chain_name, strlen(state->chain_name) + 1U) ||
		!finish_message(request, used, message_start) ||
		!append_batch_end(request, sizeof(request), &used, sequence))
		return TRANSACTION_FATAL;
	return send_batch(state, request, used, sequence);
}

static bool open_owner_socket(struct owner_state *state)
{
	#ifdef Z2M_SCANNER_HELPER_TEST
	state->fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
	if (state->fd >= 0)
		state->portid = 1;
	return state->fd >= 0;
	#else
	struct sockaddr_nl address = { .nl_family = AF_NETLINK };
	socklen_t address_length = sizeof(address);

	state->fd = socket(AF_NETLINK, SOCK_RAW | SOCK_CLOEXEC, NETLINK_NETFILTER);
	if (state->fd < 0 || bind(state->fd, (struct sockaddr *)&address, sizeof(address)) < 0)
		return false;
	if (getsockname(state->fd, (struct sockaddr *)&address, &address_length) < 0 || address.nl_pid == 0)
		return false;
	state->portid = address.nl_pid;
	return true;
	#endif
}

static enum transaction_result create_table(struct owner_state *state, const char *table_name,
	const char *operation_id, const char *nonce)
{
	char userdata[USERDATA_MAX];
	int length;

	if (state->table_created || !valid_table_name(table_name) ||
		!valid_id(operation_id, OPERATION_ID_MAX) || !valid_hex(nonce, 64U))
		return TRANSACTION_OPERATION_ERROR;
	length = snprintf(userdata, sizeof(userdata), "z2m-scanner-a1:%s:%s", operation_id, nonce);
	if (length < 1 || (size_t)length >= sizeof(userdata))
		return TRANSACTION_OPERATION_ERROR;
	{
		enum transaction_result result = netlink_transaction(state, NFT_MSG_NEWTABLE, table_name, userdata);
		if (result != TRANSACTION_OK)
			return result;
	}
	memcpy(state->table_name, table_name, strlen(table_name) + 1U);
	memcpy(state->operation_id, operation_id, strlen(operation_id) + 1U);
	memcpy(state->nonce, nonce, strlen(nonce) + 1U);
	state->table_created = true;
	return TRANSACTION_OK;
}

static enum transaction_result delete_table(struct owner_state *state, const char *table_name,
	const char *operation_id, const char *nonce)
{
	if (!state->table_created || strcmp(state->table_name, table_name) != 0 ||
		strcmp(state->operation_id, operation_id) != 0 || strcmp(state->nonce, nonce) != 0)
		return TRANSACTION_OPERATION_ERROR;
	{
		enum transaction_result result = netlink_transaction(state, NFT_MSG_DELTABLE, state->table_name, "");
		if (result != TRANSACTION_OK)
			return result;
	}
	state->table_created = false;
	state->rules_prepared = false;
	state->rules_enabled = false;
	state->table_name[0] = '\0';
	state->chain_name[0] = '\0';
	state->operation_id[0] = '\0';
	state->nonce[0] = '\0';
	state->profile[0] = '\0';
	state->generation = 0;
	state->queue = 0;
	return TRANSACTION_OK;
}

static bool handle_line(struct owner_state *state, char *line)
{
	char request_id[OPERATION_ID_MAX];
	char operation[32];
	char table_name[TABLE_NAME_MAX];
	char operation_id[OPERATION_ID_MAX];
	char nonce[NONCE_MAX];
	char profile[PROFILE_MAX] = { 0 };
	uint32_t generation = 0;
	uint16_t queue = 0;

	if (!parse_line(line, request_id, sizeof(request_id), operation, sizeof(operation),
		table_name, sizeof(table_name), operation_id, sizeof(operation_id), nonce, sizeof(nonce),
		&generation, &queue, profile, sizeof(profile))) {
		emit_error(request_id[0] != '\0' ? request_id : NULL, "ESCHEMA", "schema");
		return true;
	}
	if (strcmp(operation, "ownership_create") == 0) {
		enum transaction_result result = create_table(state, table_name, operation_id, nonce);
		if (result != TRANSACTION_OK) {
			emit_error(request_id, result == TRANSACTION_FATAL ? "EINTERNAL" : "EOWNERSHIP", "ownership_create");
			return result != TRANSACTION_FATAL;
		}
		emit_state(request_id, "ownership_create", state->table_name, state);
		return true;
	}
	if (strcmp(operation, "ownership_status") == 0) {
		if (!state->table_created) {
			emit_error(request_id, "EOWNERSHIP", "ownership_status");
			return true;
		}
	}
	if (strcmp(operation, "rules_prepare") == 0) {
		if (!state->table_created || state->rules_prepared ||
			strcmp(state->table_name, table_name) != 0 ||
			strcmp(state->operation_id, operation_id) != 0 || strcmp(state->nonce, nonce) != 0 ||
			!make_chain_name(state->chain_name, sizeof(state->chain_name), generation, nonce)) {
			emit_error(request_id, "EOWNERSHIP", "rules_prepare");
			return true;
		}
		state->generation = generation;
		state->queue = queue;
		memcpy(state->profile, profile, strlen(profile) + 1U);
		if (install_chain(state) != TRANSACTION_OK) {
			state->profile[0] = '\0';
			emit_error(request_id, "EOWNERSHIP", "rules_prepare");
			return true;
		}
		state->rules_prepared = true;
		emit_state(request_id, operation, state->table_name, state);
		return true;
	}
	if (strcmp(operation, "rules_enable") == 0) {
		if (!state->table_created || !state->rules_prepared || state->rules_enabled ||
			strcmp(state->table_name, table_name) != 0 ||
			strcmp(state->operation_id, operation_id) != 0 || strcmp(state->nonce, nonce) != 0 ||
			state->generation != generation || state->queue != queue ||
			strcmp(state->profile, profile) != 0) {
			emit_error(request_id, "EOWNERSHIP", "rules_enable");
			return true;
		}
		if (install_rule(state) != TRANSACTION_OK) {
			emit_error(request_id, "EOWNERSHIP", "rules_enable");
			return true;
		}
		state->rules_enabled = true;
		emit_state(request_id, operation, state->table_name, state);
		return true;
	}
	if (strcmp(operation, "rules_disable") == 0) {
		if (!state->table_created || !state->rules_prepared ||
			strcmp(state->table_name, table_name) != 0 ||
			strcmp(state->operation_id, operation_id) != 0 || strcmp(state->nonce, nonce) != 0 ||
			state->generation != generation || state->queue != queue ||
			strcmp(state->profile, profile) != 0) {
			emit_error(request_id, "EOWNERSHIP", "rules_disable");
			return true;
		}
		if (delete_chain(state) != TRANSACTION_OK) {
			emit_error(request_id, "EOWNERSHIP", "rules_disable");
			return true;
		}
		state->rules_prepared = false;
		state->rules_enabled = false;
		state->chain_name[0] = '\0';
		emit_state(request_id, operation, state->table_name, state);
		return true;
	}
	if (strcmp(operation, "ownership_ready") == 0 || strcmp(operation, "ownership_status") == 0) {
		bool matches = state->table_created && strcmp(state->table_name, table_name) == 0 &&
			strcmp(state->operation_id, operation_id) == 0 && strcmp(state->nonce, nonce) == 0;
		if (!matches) {
			emit_error(request_id, "EOWNERSHIP", operation);
			return true;
		}
		emit_state(request_id, operation, state->table_name, state);
		return matches;
	}
	if (strcmp(operation, "ownership_delete") == 0) {
		struct owner_state deleted_state = *state;
		enum transaction_result result = delete_table(state, table_name, operation_id, nonce);
		if (result == TRANSACTION_OK) {
			emit_state(request_id, "ownership_delete", deleted_state.table_name, &deleted_state);
		} else {
			emit_error(request_id, result == TRANSACTION_FATAL ? "EINTERNAL" : "EOWNERSHIP", "ownership_delete");
		}
		return result != TRANSACTION_FATAL;
	}
	emit_error(request_id, "ESCHEMA", "operation");
	return false;
}

int main(void)
{
	struct owner_state state = { .fd = -1 };
	char line[REQUEST_MAX + 2U];
	struct sigaction action = { 0 };

	action.sa_handler = stop_handler;
	setvbuf(stdin, NULL, _IONBF, 0);
	sigemptyset(&action.sa_mask);
	sigaction(SIGTERM, &action, NULL);
	sigaction(SIGINT, &action, NULL);
	sigaction(SIGHUP, &action, NULL);
	if (!open_owner_socket(&state)) {
		if (state.fd >= 0)
			close(state.fd);
		emit_error(NULL, "EINTERNAL", "netlink");
		return 1;
	}
	while (!stopping) {
		enum read_result result = read_request_line(line, sizeof(line));
		if (result == READ_END)
			break;
		if (result == READ_TOO_BIG) {
			emit_error(NULL, "EREQUESTTOOBIG", "request");
			continue;
		}
		if (result == READ_MALFORMED) {
			emit_error(NULL, "EMALFORMED", "request");
			continue;
		}
		if (!handle_line(&state, line))
			break;
	}
	if (state.fd >= 0)
		close(state.fd);
	return 0;
}
