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
#define NETLINK_BUFFER 8192U
#define NFT_TABLE_F_OWNER 0x2U
#define SCANNER_QUEUE_MIN 300U
#define SCANNER_QUEUE_MAX 307U
#define SCANNER_CHAIN "z2m_scan_prerouting"
#define NLA_DATA_LOCAL(attribute) ((unsigned char *)(attribute) + sizeof(struct nlattr))
#define NFQ_PROC_PATH "/proc/net/netfilter/nfnetlink_queue"

struct owner_state {
	int fd;
	uint32_t portid;
	bool table_created;
	bool kernel_read_back;
	bool chain_created;
	bool rule_created;
	bool queue_bound;
	bool active;
	uint16_t queue;
	uint32_t peer_pid;
	char table_name[TABLE_NAME_MAX];
	char operation_id[OPERATION_ID_MAX];
	char nonce[NONCE_MAX];
};

static volatile sig_atomic_t stopping;

static void reset_nfqueue_state(struct owner_state *state);

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

static bool valid_queue(uint32_t queue)
{
	return queue >= SCANNER_QUEUE_MIN && queue <= SCANNER_QUEUE_MAX;
}

static bool valid_peer_pid(uint32_t peer_pid)
{
	return peer_pid <= INT32_MAX;
}

static bool uint_field(json_object *object, const char *name, uint32_t *output)
{
	json_object *value;
	int64_t number;

	if (!json_object_object_get_ex(object, name, &value) ||
		!json_object_is_type(value, json_type_int))
		return false;
	number = json_object_get_int64(value);
	if (number < 0 || number > UINT32_MAX)
		return false;
	*output = (uint32_t)number;
	return true;
}

static bool valid_table_name(const char *value)
{
	return value && strlen(value) == 62U && strncmp(value, "z2m_sc_", 7) == 0 &&
		value[15] == '_' && value[24] == '_' && value[29] == '_' &&
		valid_hex(value + 7, 8) && valid_hex(value + 16, 8) &&
		valid_hex(value + 25, 4) && valid_hex(value + 30, 32);
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
	else if (strcmp(operation, "ownership_delete") == 0)
		json_object_object_add(data, "deleted", json_object_new_boolean(true));
	else {
		json_object_object_add(data, "exists", json_object_new_boolean(state->table_created));
		json_object_object_add(data, "owned", json_object_new_boolean(state->table_created));
	}
	json_object_object_add(data, "tableName", json_object_new_string(table_name));
	json_object_object_add(data, "chainName", json_object_new_string(SCANNER_CHAIN));
	json_object_object_add(data, "queue", json_object_new_int((int)state->queue));
	json_object_object_add(data, "chainCreated", json_object_new_boolean(state->chain_created));
	json_object_object_add(data, "ruleCreated", json_object_new_boolean(state->rule_created));
	json_object_object_add(data, "queueBound", json_object_new_boolean(state->queue_bound));
	json_object_object_add(data, "active", json_object_new_boolean(state->active));
	json_object_object_add(data, "peerPid", json_object_new_int64((int64_t)state->peer_pid));
	json_object_object_add(data, "peer_portid", json_object_new_int64((int64_t)state->peer_pid));
	json_object_object_add(evidence, "tableName", json_object_new_string(table_name));
	json_object_object_add(evidence, "operationId", json_object_new_string(state->operation_id));
	json_object_object_add(evidence, "nonce", json_object_new_string(state->nonce));
	json_object_object_add(evidence, "ownerFlagRequested", json_object_new_boolean(true));
	json_object_object_add(evidence, "kernelReadBack", json_object_new_boolean(state->kernel_read_back));
	json_object_object_add(evidence, "chainCreated", json_object_new_boolean(state->chain_created));
	json_object_object_add(evidence, "ruleCreated", json_object_new_boolean(state->rule_created));
	json_object_object_add(evidence, "queue", json_object_new_int((int)state->queue));
	json_object_object_add(evidence, "queueBound", json_object_new_boolean(state->queue_bound));
	json_object_object_add(evidence, "peerPid", json_object_new_int64((int64_t)state->peer_pid));
	json_object_object_add(evidence, "peer_portid", json_object_new_int64((int64_t)state->peer_pid));
	json_object_object_add(evidence, "active", json_object_new_boolean(state->active));
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
	char *nonce, size_t nonce_capacity, uint32_t *queue, uint32_t *peer_pid)
{
	static const char *const fields[] = { "protocolVersion", "requestId", "operation", "arguments" };
	static const char *const argument_fields[] = { "tableName", "operationId", "nonce", "queue", "peerPid" };
	json_tokener *tokener;
	json_object *document = NULL;
	json_object *value, *arguments;
	bool valid = false;
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
		exact_fields(arguments, argument_fields, sizeof(argument_fields) / sizeof(argument_fields[0])) &&
		string_field(arguments, "tableName", table_name, table_name_capacity) &&
		string_field(arguments, "operationId", operation_id, operation_id_capacity) &&
		string_field(arguments, "nonce", nonce, nonce_capacity) &&
		uint_field(arguments, "queue", queue) && uint_field(arguments, "peerPid", peer_pid) &&
		json_object_object_get_ex(document, "operation", &value)) {
		valid = valid_id(request_id, request_id_capacity) &&
			valid_id(operation_id, operation_id_capacity) &&
			valid_id(nonce, nonce_capacity) &&
			strlen(nonce) == 64U && valid_hex(nonce, 64U) &&
			valid_queue(*queue) && valid_peer_pid(*peer_pid) &&
			valid_table_name(table_name) &&
			(strcmp(operation, "ownership_create") == 0 ||
				strcmp(operation, "ownership_ready") == 0 ||
				strcmp(operation, "ownership_delete") == 0 ||
				strcmp(operation, "ownership_status") == 0 ||
				strcmp(operation, "ownership_nfqueue_prepare") == 0 ||
				strcmp(operation, "ownership_nfqueue_bind") == 0 ||
				strcmp(operation, "ownership_nfqueue_activate") == 0) &&
			strcmp(json_object_get_string(value), operation) == 0;
	}
	if (document)
		json_object_put(document);
	json_tokener_free(tokener);
	return valid;
}

static enum transaction_result netlink_transaction(struct owner_state *state, uint16_t message,
	const char *table_name, const char *userdata)
{
	unsigned char request[NETLINK_BUFFER] = { 0 };
	unsigned char response[NETLINK_BUFFER];
	struct nlmsghdr *header;
	struct nlmsghdr *batch_begin = (struct nlmsghdr *)request;
	struct nlmsghdr *batch_end;
	struct nfgenmsg *generic;
	struct nfgenmsg *batch_generic;
	struct sockaddr_nl address = { .nl_family = AF_NETLINK };
	uint32_t flags = htonl(NFT_TABLE_F_OWNER);
	static uint32_t sequence = 1;
	uint32_t expected_sequence;
	struct pollfd descriptor = { .fd = state->fd, .events = POLLIN };
	int remaining = NETLINK_TIMEOUT_MS;
	struct timespec started;
	size_t used = 0;
	size_t message_start;

	batch_begin->nlmsg_len = NLMSG_LENGTH(sizeof(*batch_generic));
	batch_begin->nlmsg_type = NFNL_MSG_BATCH_BEGIN;
	batch_begin->nlmsg_flags = NLM_F_REQUEST;
	batch_begin->nlmsg_seq = sequence++;
	batch_generic = (struct nfgenmsg *)NLMSG_DATA(batch_begin);
	batch_generic->nfgen_family = AF_UNSPEC;
	batch_generic->version = NFNETLINK_V0;
	batch_generic->res_id = htons(NFNL_SUBSYS_NFTABLES);
	used += NLMSG_ALIGN(batch_begin->nlmsg_len);
	message_start = used;
	header = (struct nlmsghdr *)(request + used);

	header->nlmsg_len = NLMSG_LENGTH(sizeof(*generic));
	header->nlmsg_type = (uint16_t)((NFNL_SUBSYS_NFTABLES << 8) | message);
	header->nlmsg_flags = NLM_F_REQUEST | NLM_F_ACK;
	if (message == NFT_MSG_NEWCHAIN || message == NFT_MSG_NEWRULE)
		header->nlmsg_flags |= NLM_F_CREATE | NLM_F_EXCL;
	expected_sequence = sequence++;
	header->nlmsg_seq = expected_sequence;
	generic = (struct nfgenmsg *)NLMSG_DATA(header);
	generic->nfgen_family = NFPROTO_INET;
	generic->version = NFNETLINK_V0;
	generic->res_id = htons(0);
	used += NLMSG_LENGTH(sizeof(*generic));
	if (!append_attr(request, sizeof(request), &used, NFTA_TABLE_NAME,
		table_name, strlen(table_name) + 1U))
		return TRANSACTION_FATAL;
	if (message == NFT_MSG_NEWTABLE) {
		if (!append_attr(request, sizeof(request), &used, NFTA_TABLE_FLAGS,
			&flags, sizeof(flags)) || !append_attr(request, sizeof(request), &used,
			NFTA_TABLE_USERDATA, userdata, strlen(userdata)))
			return TRANSACTION_FATAL;
		header->nlmsg_flags |= NLM_F_CREATE | NLM_F_EXCL;
	}
	header->nlmsg_len = (uint32_t)(used - message_start);
	batch_end = (struct nlmsghdr *)(request + used);
	batch_end->nlmsg_len = NLMSG_LENGTH(sizeof(*batch_generic));
	batch_end->nlmsg_type = NFNL_MSG_BATCH_END;
	batch_end->nlmsg_flags = NLM_F_REQUEST;
	batch_end->nlmsg_seq = sequence++;
	batch_generic = (struct nfgenmsg *)NLMSG_DATA(batch_end);
	batch_generic->nfgen_family = AF_UNSPEC;
	batch_generic->version = NFNETLINK_V0;
	batch_generic->res_id = htons(NFNL_SUBSYS_NFTABLES);
	used += NLMSG_ALIGN(batch_end->nlmsg_len);
	if (sendto(state->fd, request, used, 0, (struct sockaddr *)&address, sizeof(address)) < 0)
		return TRANSACTION_FATAL;
	if (clock_gettime(CLOCK_MONOTONIC, &started) < 0)
		return TRANSACTION_FATAL;
	for (;;) {
		struct timespec now;
		int elapsed;
		int ready;
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
			if (message_header->nlmsg_seq != expected_sequence)
				continue;
			if (message_header->nlmsg_type != NLMSG_ERROR ||
				message_header->nlmsg_len < NLMSG_LENGTH(sizeof(struct nlmsgerr)))
				return TRANSACTION_FATAL;
			struct nlmsgerr *error = (struct nlmsgerr *)NLMSG_DATA(message_header);
			return error->error == 0 ? TRANSACTION_OK : TRANSACTION_OPERATION_ERROR;
		}
		if (bytes != 0)
			return TRANSACTION_FATAL;
	}
}

static enum transaction_result netlink_transaction_attrs(struct owner_state *state, uint16_t message,
	const unsigned char *attributes, size_t attributes_length)
{
	unsigned char request[NETLINK_BUFFER] = { 0 };
	unsigned char response[NETLINK_BUFFER];
	struct nlmsghdr *batch_begin = (struct nlmsghdr *)request;
	struct nlmsghdr *header;
	struct nlmsghdr *batch_end;
	struct nfgenmsg *generic;
	struct nfgenmsg *batch_generic;
	struct sockaddr_nl address = { .nl_family = AF_NETLINK };
	struct pollfd descriptor = { .fd = state->fd, .events = POLLIN };
	static uint32_t sequence = 200000U;
	uint32_t expected_sequence;
	struct timespec started;
	size_t used = 0;
	size_t message_start;

	if (!attributes || attributes_length > NETLINK_BUFFER - 256U)
		return TRANSACTION_FATAL;
	batch_begin->nlmsg_len = NLMSG_LENGTH(sizeof(*batch_generic));
	batch_begin->nlmsg_type = NFNL_MSG_BATCH_BEGIN;
	batch_begin->nlmsg_flags = NLM_F_REQUEST;
	batch_begin->nlmsg_seq = sequence++;
	batch_generic = (struct nfgenmsg *)NLMSG_DATA(batch_begin);
	batch_generic->nfgen_family = AF_UNSPEC;
	batch_generic->version = NFNETLINK_V0;
	batch_generic->res_id = htons(NFNL_SUBSYS_NFTABLES);
	used += NLMSG_ALIGN(batch_begin->nlmsg_len);
	message_start = used;
	header = (struct nlmsghdr *)(request + used);
	header->nlmsg_len = NLMSG_LENGTH(sizeof(*generic));
	header->nlmsg_type = (uint16_t)((NFNL_SUBSYS_NFTABLES << 8) | message);
	header->nlmsg_flags = NLM_F_REQUEST | NLM_F_ACK;
	expected_sequence = sequence++;
	header->nlmsg_seq = expected_sequence;
	generic = (struct nfgenmsg *)NLMSG_DATA(header);
	generic->nfgen_family = NFPROTO_INET;
	generic->version = NFNETLINK_V0;
	generic->res_id = htons(0);
	used += NLMSG_LENGTH(sizeof(*generic));
	memcpy(request + used, attributes, attributes_length);
	used += attributes_length;
	header->nlmsg_len = (uint32_t)(used - message_start);
	batch_end = (struct nlmsghdr *)(request + used);
	batch_end->nlmsg_len = NLMSG_LENGTH(sizeof(*batch_generic));
	batch_end->nlmsg_type = NFNL_MSG_BATCH_END;
	batch_end->nlmsg_flags = NLM_F_REQUEST;
	batch_end->nlmsg_seq = sequence++;
	batch_generic = (struct nfgenmsg *)NLMSG_DATA(batch_end);
	batch_generic->nfgen_family = AF_UNSPEC;
	batch_generic->version = NFNETLINK_V0;
	batch_generic->res_id = htons(NFNL_SUBSYS_NFTABLES);
	used += NLMSG_ALIGN(batch_end->nlmsg_len);
	if (sendto(state->fd, request, used, 0, (struct sockaddr *)&address, sizeof(address)) < 0)
		return TRANSACTION_FATAL;
	if (clock_gettime(CLOCK_MONOTONIC, &started) < 0)
		return TRANSACTION_FATAL;
	for (;;) {
		struct timespec now;
		int elapsed;
		int ready;
		ssize_t received;
		if (clock_gettime(CLOCK_MONOTONIC, &now) < 0)
			return TRANSACTION_FATAL;
		elapsed = (int)((now.tv_sec - started.tv_sec) * 1000L +
			(now.tv_nsec - started.tv_nsec) / 1000000L);
		if (elapsed >= NETLINK_TIMEOUT_MS)
			return TRANSACTION_FATAL;
		ready = poll(&descriptor, 1, NETLINK_TIMEOUT_MS - elapsed);
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
		for (struct nlmsghdr *reply = (struct nlmsghdr *)response; NLMSG_OK(reply, bytes);
			reply = NLMSG_NEXT(reply, bytes)) {
			if (reply->nlmsg_seq != expected_sequence)
				continue;
			if (reply->nlmsg_type != NLMSG_ERROR ||
				reply->nlmsg_len < NLMSG_LENGTH(sizeof(struct nlmsgerr)))
				return TRANSACTION_FATAL;
			struct nlmsgerr *error = (struct nlmsgerr *)NLMSG_DATA(reply);
			return error->error == 0 ? TRANSACTION_OK : TRANSACTION_OPERATION_ERROR;
		}
		if (bytes != 0)
			return TRANSACTION_FATAL;
	}
}

static bool append_nested(unsigned char *buffer, size_t capacity, size_t *used,
	uint16_t type, const unsigned char *value, size_t value_length)
{
	return append_attr(buffer, capacity, used, type | NLA_F_NESTED, value, value_length);
}

static enum transaction_result create_nfqueue_chain(struct owner_state *state)
{
	unsigned char attributes[2048] = { 0 };
	unsigned char hook[256] = { 0 };
	size_t used = 0, hook_used = 0;
	uint32_t hook_number = NF_INET_FORWARD;
	int32_t priority = -150;

	if (!append_attr(attributes, sizeof(attributes), &used, NFTA_CHAIN_TABLE,
		state->table_name, strlen(state->table_name) + 1U) ||
		!append_attr(attributes, sizeof(attributes), &used, NFTA_CHAIN_NAME,
		SCANNER_CHAIN, sizeof(SCANNER_CHAIN)) ||
		!append_attr(hook, sizeof(hook), &hook_used, NFTA_HOOK_HOOKNUM,
		&hook_number, sizeof(hook_number)) ||
		!append_attr(hook, sizeof(hook), &hook_used, NFTA_HOOK_PRIORITY,
		&priority, sizeof(priority)) ||
		!append_nested(attributes, sizeof(attributes), &used, NFTA_CHAIN_HOOK,
		hook, hook_used))
		return TRANSACTION_FATAL;
	return netlink_transaction_attrs(state, NFT_MSG_NEWCHAIN, attributes, used);
}

static enum transaction_result create_nfqueue_rule(struct owner_state *state)
{
	unsigned char attributes[2048] = { 0 };
	unsigned char expressions[1024] = { 0 };
	unsigned char expression[512] = { 0 };
	unsigned char expression_data[256] = { 0 };
	unsigned char queue_number[sizeof(uint16_t)];
	size_t used = 0, expressions_used = 0, expression_used = 0, data_used = 0;
	uint16_t queue = state->queue;

	memcpy(queue_number, &queue, sizeof(queue));
	if (!append_attr(attributes, sizeof(attributes), &used, NFTA_RULE_TABLE,
		state->table_name, strlen(state->table_name) + 1U) ||
		!append_attr(attributes, sizeof(attributes), &used, NFTA_RULE_CHAIN,
		SCANNER_CHAIN, sizeof(SCANNER_CHAIN)) ||
		!append_attr(expression, sizeof(expression), &expression_used, NFTA_EXPR_NAME,
		"queue", sizeof("queue")) ||
		!append_attr(expression_data, sizeof(expression_data), &data_used,
		NFTA_QUEUE_NUM, queue_number, sizeof(queue_number)) ||
		!append_nested(expression, sizeof(expression), &expression_used, NFTA_EXPR_DATA,
		expression_data, data_used) ||
		!append_nested(expressions, sizeof(expressions), &expressions_used,
		NFTA_LIST_ELEM, expression, expression_used) ||
		!append_nested(attributes, sizeof(attributes), &used, NFTA_RULE_EXPRESSIONS,
		expressions, expressions_used))
		return TRANSACTION_FATAL;
	return netlink_transaction_attrs(state, NFT_MSG_NEWRULE, attributes, used);
}

static enum transaction_result kernel_read_back(struct owner_state *state, const char *table_name,
	const char *expected_userdata, bool expected_present)
{
	unsigned char request[NETLINK_BUFFER] = { 0 };
	unsigned char response[NETLINK_BUFFER] = { 0 };
	struct nlmsghdr *header = (struct nlmsghdr *)request;
	struct nfgenmsg *generic;
	struct sockaddr_nl address = { .nl_family = AF_NETLINK };
	struct pollfd descriptor = { .fd = state->fd, .events = POLLIN };
	static uint32_t sequence = 100000U;
	uint32_t expected_sequence = sequence++;
	struct timespec started, now;
	size_t used = NLMSG_LENGTH(sizeof(*generic));
	bool found = false, owner = false, metadata = false;
	char found_name[TABLE_NAME_MAX] = { 0 };
	int remaining;

	header->nlmsg_len = (uint32_t)used;
	header->nlmsg_type = (uint16_t)((NFNL_SUBSYS_NFTABLES << 8) | NFT_MSG_GETTABLE);
	header->nlmsg_flags = NLM_F_REQUEST | NLM_F_ACK;
	header->nlmsg_seq = expected_sequence;
	generic = (struct nfgenmsg *)NLMSG_DATA(header);
	generic->nfgen_family = NFPROTO_INET;
	generic->version = NFNETLINK_V0;
	generic->res_id = htons(0);
	if (!append_attr(request, sizeof(request), &used, NFTA_TABLE_NAME,
		table_name, strlen(table_name) + 1U))
		return TRANSACTION_FATAL;
	header->nlmsg_len = (uint32_t)used;
	if (sendto(state->fd, request, used, 0, (struct sockaddr *)&address, sizeof(address)) < 0)
		return TRANSACTION_FATAL;
	if (clock_gettime(CLOCK_MONOTONIC, &started) < 0)
		return TRANSACTION_FATAL;
	for (;;) {
		int ready;
		ssize_t received;
		if (clock_gettime(CLOCK_MONOTONIC, &now) < 0)
			return TRANSACTION_FATAL;
		remaining = NETLINK_TIMEOUT_MS - (int)((now.tv_sec - started.tv_sec) * 1000L +
			(now.tv_nsec - started.tv_nsec) / 1000000L);
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
		for (struct nlmsghdr *reply = (struct nlmsghdr *)response; NLMSG_OK(reply, bytes);
			reply = NLMSG_NEXT(reply, bytes)) {
			if (reply->nlmsg_seq != expected_sequence)
				continue;
			if (reply->nlmsg_type == NLMSG_ERROR) {
				struct nlmsgerr *error;
				if (reply->nlmsg_len < NLMSG_LENGTH(sizeof(*error))) return TRANSACTION_FATAL;
				error = (struct nlmsgerr *)NLMSG_DATA(reply);
				if (error->error != 0) return expected_present ? TRANSACTION_OPERATION_ERROR : TRANSACTION_OK;
				if (!expected_present) return TRANSACTION_OPERATION_ERROR;
				continue;
			}
			if (reply->nlmsg_type != ((NFNL_SUBSYS_NFTABLES << 8) | NFT_MSG_NEWTABLE))
				continue;
			if (reply->nlmsg_len < NLMSG_LENGTH(sizeof(struct nfgenmsg))) return TRANSACTION_FATAL;
			struct nlattr *attribute = (struct nlattr *)((unsigned char *)NLMSG_DATA(reply) +
				NLMSG_ALIGN(sizeof(struct nfgenmsg)));
			int attribute_bytes = (int)reply->nlmsg_len - NLMSG_LENGTH(sizeof(struct nfgenmsg));
			for (; attribute_bytes >= (int)sizeof(*attribute) && attribute->nla_len >= sizeof(*attribute) &&
				attribute->nla_len <= (unsigned int)attribute_bytes; attribute = (struct nlattr *)((unsigned char *)attribute + nla_align(attribute->nla_len))) {
				size_t payload = attribute->nla_len - sizeof(*attribute);
				switch (attribute->nla_type & NLA_TYPE_MASK) {
				case NFTA_TABLE_NAME:
					if (payload == strlen(table_name) + 1U && memcmp(NLA_DATA_LOCAL(attribute), table_name, payload) == 0) {
						found = true; memcpy(found_name, NLA_DATA_LOCAL(attribute), payload);
					}
					break;
				case NFTA_TABLE_FLAGS:
					if (payload == sizeof(uint32_t)) { uint32_t flags; memcpy(&flags, NLA_DATA_LOCAL(attribute), sizeof(flags)); owner = flags == NFT_TABLE_F_OWNER || ntohl(flags) == NFT_TABLE_F_OWNER; }
					break;
				case NFTA_TABLE_USERDATA:
					if (payload == strlen(expected_userdata) && memcmp(NLA_DATA_LOCAL(attribute), expected_userdata, payload) == 0) metadata = true;
					break;
				default: break;
				}
				attribute_bytes -= (int)nla_align(attribute->nla_len);
			}
		}
		if (expected_present && found && owner && metadata && strcmp(found_name, table_name) == 0) return TRANSACTION_OK;
		if (!expected_present && !found) return TRANSACTION_OK;
	}
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
		if (kernel_read_back(state, table_name, userdata, true) != TRANSACTION_OK)
		return TRANSACTION_OPERATION_ERROR;
	memcpy(state->table_name, table_name, strlen(table_name) + 1U);
	memcpy(state->operation_id, operation_id, strlen(operation_id) + 1U);
	memcpy(state->nonce, nonce, strlen(nonce) + 1U);
	state->table_created = true;
	state->kernel_read_back = true;
	reset_nfqueue_state(state);
	return TRANSACTION_OK;
}

static bool queue_peer(uint16_t queue, uint32_t *peer_pid)
{
	FILE *file = fopen(NFQ_PROC_PATH, "r");
	char line[512];
	unsigned int observed_queue, observed_peer;

	if (!file)
		return false;
	while (fgets(line, sizeof(line), file)) {
		if (sscanf(line, "%u %u", &observed_queue, &observed_peer) == 2 &&
			observed_queue == queue && observed_peer <= INT32_MAX) {
			*peer_pid = observed_peer;
			fclose(file);
			return true;
		}
	}
	fclose(file);
	return false;
}

static bool request_matches(const struct owner_state *state, const char *table_name,
	const char *operation_id, const char *nonce)
{
	return state->table_created && strcmp(state->table_name, table_name) == 0 &&
		strcmp(state->operation_id, operation_id) == 0 && strcmp(state->nonce, nonce) == 0;
}

static void reset_nfqueue_state(struct owner_state *state)
{
	state->chain_created = false;
	state->rule_created = false;
	state->queue_bound = false;
	state->active = false;
	state->queue = 0;
	state->peer_pid = 0;
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
	if (kernel_read_back(state, table_name, "", false) != TRANSACTION_OK)
		return TRANSACTION_FATAL;
	state->table_created = false;
	state->kernel_read_back = false;
	reset_nfqueue_state(state);
	state->table_name[0] = '\0';
	state->operation_id[0] = '\0';
	state->nonce[0] = '\0';
	return TRANSACTION_OK;
}

static bool handle_line(struct owner_state *state, char *line)
{
	char request_id[OPERATION_ID_MAX];
	char operation[32];
	char table_name[TABLE_NAME_MAX];
	char operation_id[OPERATION_ID_MAX];
	char nonce[NONCE_MAX];
	uint32_t queue;
	uint32_t peer_pid;

	if (!parse_line(line, request_id, sizeof(request_id), operation, sizeof(operation),
		table_name, sizeof(table_name), operation_id, sizeof(operation_id), nonce, sizeof(nonce),
		&queue, &peer_pid)) {
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
		char userdata[USERDATA_MAX];
		int userdata_length = snprintf(userdata, sizeof(userdata), "z2m-scanner-a1:%s:%s",
			state->operation_id, state->nonce);
		if (userdata_length < 1 || (size_t)userdata_length >= sizeof(userdata)
			|| kernel_read_back(state, state->table_name, userdata, true) != TRANSACTION_OK) {
			state->kernel_read_back = false;
			emit_error(request_id, "EOWNERSHIP", "ownership_status");
			return true;
		}
		state->kernel_read_back = true;
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
	if (strcmp(operation, "ownership_nfqueue_prepare") == 0) {
		if (!request_matches(state, table_name, operation_id, nonce) || !valid_queue(queue)) {
			emit_error(request_id, "EOWNERSHIP", operation);
			return true;
		}
		if (state->chain_created || state->rule_created) {
			emit_error(request_id, "EOWNERSHIP", operation);
			return true;
		}
		state->queue = (uint16_t)queue;
		if (create_nfqueue_chain(state) != TRANSACTION_OK ||
			create_nfqueue_rule(state) != TRANSACTION_OK) {
			emit_error(request_id, "EOWNERSHIP", operation);
			return true;
		}
		state->chain_created = true;
		state->rule_created = true;
		emit_state(request_id, operation, state->table_name, state);
		return true;
	}
	if (strcmp(operation, "ownership_nfqueue_bind") == 0 ||
	    strcmp(operation, "ownership_nfqueue_activate") == 0) {
		if (!request_matches(state, table_name, operation_id, nonce) ||
			!state->chain_created || !state->rule_created || state->queue != queue ||
			peer_pid < 2) {
			emit_error(request_id, "EOWNERSHIP", operation);
			return true;
		}
		if (!queue_peer(state->queue, &state->peer_pid) || state->peer_pid != peer_pid) {
			emit_error(request_id, "EOWNERSHIP", operation);
			return true;
		}
		state->queue_bound = true;
		state->active = strcmp(operation, "ownership_nfqueue_activate") == 0;
		emit_state(request_id, operation, state->table_name, state);
		return state->active || strcmp(operation, "ownership_nfqueue_bind") == 0;
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
