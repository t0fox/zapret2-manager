#include "helper.h"

#include <limits.h>
#include <stdlib.h>
#include <string.h>

enum frame_type {
	FRAME_ARRAY,
	FRAME_OBJECT
};

enum frame_state {
	ARRAY_FIRST,
	ARRAY_VALUE,
	ARRAY_AFTER_VALUE,
	OBJECT_FIRST,
	OBJECT_KEY,
	OBJECT_COLON,
	OBJECT_VALUE,
	OBJECT_AFTER_VALUE
};

struct canonical_key {
	unsigned char *data;
	size_t length;
};

struct canonical_frame {
	enum frame_type type;
	enum frame_state state;
	struct canonical_key *keys;
	size_t key_count;
	size_t key_capacity;
};

struct canonical_scan {
	const unsigned char *data;
	size_t length;
	size_t offset;
	struct canonical_frame frames[Z2M_CANONICAL_MAX_DEPTH];
	size_t frame_count;
	size_t containers;
	size_t members;
	size_t nodes;
	bool root_complete;
	struct z2m_canonical_error *error;
};

static bool reject(struct canonical_scan *scan, const char *code,
	const char *stage)
{
	scan->error->code = code;
	scan->error->stage = stage;
	return false;
}

static bool reject_malformed(struct canonical_scan *scan)
{
	return reject(scan, "EMALFORMED", "json_decode");
}

static bool reject_schema(struct canonical_scan *scan)
{
	return reject(scan, "ESCHEMA", "canonical_validate");
}

static bool reject_internal(struct canonical_scan *scan)
{
	return reject(scan, "EINTERNAL", "canonical_encode");
}

static bool is_json_whitespace(unsigned char byte)
{
	return byte == ' ' || byte == '\t' || byte == '\r' || byte == '\n';
}

static void skip_whitespace(struct canonical_scan *scan)
{
	while (scan->offset < scan->length &&
		is_json_whitespace(scan->data[scan->offset]))
		scan->offset++;
}

static bool decode_utf8(const unsigned char *data, size_t length,
	size_t *offset, uint32_t *codepoint)
{
	size_t start = *offset;
	unsigned char first;
	size_t continuation;
	uint32_t value;

	if (start >= length)
		return false;
	first = data[start++];
	if (first < 0x80) {
		*codepoint = first;
		*offset = start;
		return first != 0;
	}
	if (first >= 0xc2 && first <= 0xdf) {
		value = first & 0x1fU;
		continuation = 1;
	} else if (first >= 0xe0 && first <= 0xef) {
		value = first & 0x0fU;
		continuation = 2;
	} else if (first >= 0xf0 && first <= 0xf4) {
		value = first & 0x07U;
		continuation = 3;
	} else {
		return false;
	}
	if (continuation > length - start)
		return false;
	for (size_t i = 0; i < continuation; i++) {
		unsigned char next = data[start++];
		if ((next & 0xc0U) != 0x80U)
			return false;
		value = (value << 6) | (next & 0x3fU);
	}
	if ((continuation == 2 && value < 0x800U) ||
		(continuation == 3 && value < 0x10000U) ||
		(value >= 0xd800U && value <= 0xdfffU) || value > 0x10ffffU)
		return false;
	*codepoint = value;
	*offset = start;
	return true;
}

static bool valid_utf8(const unsigned char *data, size_t length)
{
	size_t offset = 0;
	uint32_t codepoint;

	while (offset < length)
		if (!decode_utf8(data, length, &offset, &codepoint))
			return false;
	return true;
}

static bool append_key_bytes(struct canonical_scan *scan,
	struct canonical_key *key, size_t *capacity, const unsigned char *data,
	size_t length)
{
	size_t required;
	size_t next;
	unsigned char *grown;

	if (length > Z2M_CANONICAL_MAX_KEY_BYTES - key->length)
		return reject_schema(scan);
	required = key->length + length;
	if (required > *capacity) {
		next = *capacity == 0 ? 16U : *capacity;
		while (next < required) {
			if (next > Z2M_CANONICAL_MAX_KEY_BYTES / 2U) {
				next = Z2M_CANONICAL_MAX_KEY_BYTES;
				break;
			}
			next *= 2U;
		}
		grown = z2m_realloc(key->data, next);
		if (grown == NULL)
			return reject_internal(scan);
		key->data = grown;
		*capacity = next;
	}
	if (length != 0)
		memcpy(key->data + key->length, data, length);
	key->length = required;
	return true;
}

static bool append_codepoint(struct canonical_scan *scan,
	struct canonical_key *key, size_t *capacity, uint32_t codepoint)
{
	unsigned char encoded[4];
	size_t length;

	if (codepoint == 0)
		return reject_schema(scan);
	if (codepoint <= 0x7fU) {
		encoded[0] = (unsigned char)codepoint;
		length = 1;
	} else if (codepoint <= 0x7ffU) {
		encoded[0] = (unsigned char)(0xc0U | (codepoint >> 6));
		encoded[1] = (unsigned char)(0x80U | (codepoint & 0x3fU));
		length = 2;
	} else if (codepoint <= 0xffffU) {
		encoded[0] = (unsigned char)(0xe0U | (codepoint >> 12));
		encoded[1] = (unsigned char)(0x80U | ((codepoint >> 6) & 0x3fU));
		encoded[2] = (unsigned char)(0x80U | (codepoint & 0x3fU));
		length = 3;
	} else {
		encoded[0] = (unsigned char)(0xf0U | (codepoint >> 18));
		encoded[1] = (unsigned char)(0x80U | ((codepoint >> 12) & 0x3fU));
		encoded[2] = (unsigned char)(0x80U | ((codepoint >> 6) & 0x3fU));
		encoded[3] = (unsigned char)(0x80U | (codepoint & 0x3fU));
		length = 4;
	}
	return append_key_bytes(scan, key, capacity, encoded, length);
}

static int hex_digit(unsigned char byte)
{
	if (byte >= '0' && byte <= '9')
		return byte - '0';
	if (byte >= 'a' && byte <= 'f')
		return byte - 'a' + 10;
	if (byte >= 'A' && byte <= 'F')
		return byte - 'A' + 10;
	return -1;
}

static bool scan_hex_quad(struct canonical_scan *scan, uint32_t *value)
{
	uint32_t decoded = 0;

	if (scan->length - scan->offset < 4)
		return reject_malformed(scan);
	for (size_t i = 0; i < 4; i++) {
		int digit = hex_digit(scan->data[scan->offset++]);
		if (digit < 0)
			return reject_malformed(scan);
		decoded = (decoded << 4) | (uint32_t)digit;
	}
	*value = decoded;
	return true;
}

static bool scan_string(struct canonical_scan *scan, bool object_key,
	struct canonical_key *key)
{
	size_t capacity = 0;

	if (scan->offset >= scan->length || scan->data[scan->offset++] != '"')
		return reject_malformed(scan);
	while (scan->offset < scan->length) {
		unsigned char byte = scan->data[scan->offset++];
		uint32_t codepoint;

		if (byte == '"')
			return true;
		if (byte < 0x20U) {
			free(key == NULL ? NULL : key->data);
			if (key != NULL)
				key->data = NULL;
			return reject_malformed(scan);
		}
		if (byte == '\\') {
			if (scan->offset >= scan->length) {
				free(key == NULL ? NULL : key->data);
				if (key != NULL)
					key->data = NULL;
				return reject_malformed(scan);
			}
			byte = scan->data[scan->offset++];
			switch (byte) {
			case '"': codepoint = '"'; break;
			case '\\': codepoint = '\\'; break;
			case '/': codepoint = '/'; break;
			case 'b': codepoint = '\b'; break;
			case 'f': codepoint = '\f'; break;
			case 'n': codepoint = '\n'; break;
			case 'r': codepoint = '\r'; break;
			case 't': codepoint = '\t'; break;
			case 'u': {
				uint32_t low;
				if (!scan_hex_quad(scan, &codepoint))
					goto fail;
				if (codepoint >= 0xd800U && codepoint <= 0xdbffU) {
					if (scan->length - scan->offset < 2 ||
						scan->data[scan->offset] != '\\' ||
						scan->data[scan->offset + 1] != 'u') {
						reject_schema(scan);
						goto fail;
					}
					scan->offset += 2;
					if (!scan_hex_quad(scan, &low))
						goto fail;
					if (low < 0xdc00U || low > 0xdfffU) {
						reject_schema(scan);
						goto fail;
					}
					codepoint = 0x10000U + ((codepoint - 0xd800U) << 10) +
						(low - 0xdc00U);
				} else if (codepoint >= 0xdc00U && codepoint <= 0xdfffU) {
					reject_schema(scan);
					goto fail;
				}
				break;
			}
			default:
				reject_malformed(scan);
				goto fail;
			}
			if (object_key && !append_codepoint(scan, key, &capacity, codepoint))
				goto fail;
			continue;
		}
		if (byte >= 0x80U) {
			size_t start = scan->offset - 1;
			size_t end = start;
			if (!decode_utf8(scan->data, scan->length, &end, &codepoint)) {
				reject(scan, "EMALFORMED", "utf8");
				goto fail;
			}
			scan->offset = end;
			if (object_key && !append_key_bytes(scan, key, &capacity,
				scan->data + start, end - start))
				goto fail;
		} else if (object_key && !append_codepoint(scan, key, &capacity, byte)) {
			goto fail;
		}
	}
	reject_malformed(scan);
fail:
	if (key != NULL) {
		free(key->data);
		key->data = NULL;
		key->length = 0;
	}
	return false;
}

static int compare_keys(const void *left_value, const void *right_value)
{
	const struct canonical_key *left = left_value;
	const struct canonical_key *right = right_value;
	size_t common = left->length < right->length ? left->length : right->length;
	int compared = common == 0 ? 0 : memcmp(left->data, right->data, common);

	if (compared != 0)
		return compared;
	return left->length < right->length ? -1 : left->length > right->length;
}

static void free_frame(struct canonical_frame *frame)
{
	for (size_t i = 0; i < frame->key_count; i++)
		free(frame->keys[i].data);
	free(frame->keys);
	frame->keys = NULL;
	frame->key_count = 0;
	frame->key_capacity = 0;
}

static bool add_key(struct canonical_scan *scan, struct canonical_frame *frame,
	struct canonical_key *key)
{
	struct canonical_key *grown;
	size_t next;

	if (scan->members >= Z2M_CANONICAL_MAX_MEMBERS) {
		free(key->data);
		key->data = NULL;
		return reject_schema(scan);
	}
	scan->members++;
	if (frame->key_count == frame->key_capacity) {
		if (frame->key_capacity == 0)
			next = 8U;
		else {
			if (frame->key_capacity > SIZE_MAX / 2U) {
				free(key->data);
				key->data = NULL;
				return reject_internal(scan);
			}
			next = frame->key_capacity + frame->key_capacity;
		}
		if (next > Z2M_CANONICAL_MAX_MEMBERS)
			next = Z2M_CANONICAL_MAX_MEMBERS;
		if (next > SIZE_MAX / sizeof(*grown)) {
			free(key->data);
			key->data = NULL;
			return reject_internal(scan);
		}
		grown = z2m_realloc(frame->keys, next * sizeof(*grown));
		if (grown == NULL) {
			free(key->data);
			key->data = NULL;
			return reject_internal(scan);
		}
		frame->keys = grown;
		frame->key_capacity = next;
	}
	frame->keys[frame->key_count++] = *key;
	key->data = NULL;
	return true;
}

static bool close_object(struct canonical_scan *scan,
	struct canonical_frame *frame)
{
	if (frame->key_count > 1)
		qsort(frame->keys, frame->key_count, sizeof(*frame->keys), compare_keys);
	for (size_t i = 1; i < frame->key_count; i++)
		if (frame->keys[i - 1].length == frame->keys[i].length &&
			(frame->keys[i].length == 0 || memcmp(frame->keys[i - 1].data,
			frame->keys[i].data, frame->keys[i].length) == 0))
			return reject_schema(scan);
	return true;
}

static bool complete_value(struct canonical_scan *scan)
{
	struct canonical_frame *parent;

	if (scan->frame_count == 0) {
		scan->root_complete = true;
		return true;
	}
	parent = &scan->frames[scan->frame_count - 1];
	if (parent->type == FRAME_ARRAY && parent->state == ARRAY_VALUE)
		parent->state = ARRAY_AFTER_VALUE;
	else if (parent->type == FRAME_OBJECT && parent->state == OBJECT_VALUE)
		parent->state = OBJECT_AFTER_VALUE;
	else
		return reject_internal(scan);
	return true;
}

static bool close_container(struct canonical_scan *scan)
{
	struct canonical_frame *frame = &scan->frames[scan->frame_count - 1];
	bool valid = frame->type != FRAME_OBJECT || close_object(scan, frame);

	free_frame(frame);
	if (!valid)
		return false;
	scan->frame_count--;
	return complete_value(scan);
}

static bool scan_number(struct canonical_scan *scan)
{
	bool negative = false;
	uint64_t value = 0;
	uint64_t limit;

	if (scan->data[scan->offset] == '-') {
		negative = true;
		scan->offset++;
		if (scan->offset >= scan->length)
			return reject_malformed(scan);
	}
	if (scan->data[scan->offset] == '0') {
		scan->offset++;
		if (scan->offset < scan->length && scan->data[scan->offset] >= '0' &&
			scan->data[scan->offset] <= '9')
			return reject_malformed(scan);
	} else {
		if (scan->data[scan->offset] < '1' || scan->data[scan->offset] > '9')
			return reject_malformed(scan);
		limit = negative ? UINT64_C(9223372036854775808) :
			UINT64_C(9223372036854775807);
		while (scan->offset < scan->length && scan->data[scan->offset] >= '0' &&
			scan->data[scan->offset] <= '9') {
			unsigned int digit = scan->data[scan->offset++] - '0';
			if (value > (limit - digit) / 10U)
				return reject_schema(scan);
			value = value * 10U + digit;
		}
	}
	if (scan->offset < scan->length &&
		(scan->data[scan->offset] == '.' || scan->data[scan->offset] == 'e' ||
		scan->data[scan->offset] == 'E'))
		return reject_schema(scan);
	return complete_value(scan);
}

static bool scan_literal(struct canonical_scan *scan, const char *literal,
	size_t length)
{
	if (length > scan->length - scan->offset ||
		memcmp(scan->data + scan->offset, literal, length) != 0)
		return reject_malformed(scan);
	scan->offset += length;
	return complete_value(scan);
}

static bool scan_value(struct canonical_scan *scan)
{
	unsigned char byte;
	struct canonical_frame *frame;

	skip_whitespace(scan);
	if (scan->offset >= scan->length)
		return reject_malformed(scan);
	if (scan->frame_count + 1U > Z2M_CANONICAL_MAX_DEPTH ||
		scan->nodes >= Z2M_CANONICAL_MAX_NODES)
		return reject_schema(scan);
	scan->nodes++;
	byte = scan->data[scan->offset];
	if (byte == '{' || byte == '[') {
		if (scan->containers >= Z2M_CANONICAL_MAX_CONTAINERS)
			return reject_schema(scan);
		scan->containers++;
		frame = &scan->frames[scan->frame_count++];
		memset(frame, 0, sizeof(*frame));
		frame->type = byte == '{' ? FRAME_OBJECT : FRAME_ARRAY;
		frame->state = byte == '{' ? OBJECT_FIRST : ARRAY_FIRST;
		scan->offset++;
		return true;
	}
	if (byte == '"') {
		if (!scan_string(scan, false, NULL))
			return false;
		return complete_value(scan);
	}
	if (byte == 'n')
		return scan_literal(scan, "null", 4);
	if (byte == 't')
		return scan_literal(scan, "true", 4);
	if (byte == 'f')
		return scan_literal(scan, "false", 5);
	if (byte == '-' || (byte >= '0' && byte <= '9'))
		return scan_number(scan);
	return reject_malformed(scan);
}

static bool scan_array_frame(struct canonical_scan *scan,
	struct canonical_frame *frame)
{
	skip_whitespace(scan);
	if (frame->state == ARRAY_FIRST) {
		if (scan->offset < scan->length && scan->data[scan->offset] == ']') {
			scan->offset++;
			return close_container(scan);
		}
		frame->state = ARRAY_VALUE;
		return scan_value(scan);
	}
	if (frame->state == ARRAY_VALUE)
		return scan_value(scan);
	if (scan->offset < scan->length && scan->data[scan->offset] == ']') {
		scan->offset++;
		return close_container(scan);
	}
	if (scan->offset >= scan->length || scan->data[scan->offset++] != ',')
		return reject_malformed(scan);
	frame->state = ARRAY_VALUE;
	return true;
}

static bool scan_object_frame(struct canonical_scan *scan,
	struct canonical_frame *frame)
{
	struct canonical_key key = {0};

	skip_whitespace(scan);
	if (frame->state == OBJECT_FIRST) {
		if (scan->offset < scan->length && scan->data[scan->offset] == '}') {
			scan->offset++;
			return close_container(scan);
		}
		frame->state = OBJECT_KEY;
	}
	if (frame->state == OBJECT_KEY) {
		if (!scan_string(scan, true, &key))
			return false;
		if (!add_key(scan, frame, &key))
			return false;
		frame->state = OBJECT_COLON;
		return true;
	}
	if (frame->state == OBJECT_COLON) {
		if (scan->offset >= scan->length || scan->data[scan->offset++] != ':')
			return reject_malformed(scan);
		frame->state = OBJECT_VALUE;
		return true;
	}
	if (frame->state == OBJECT_VALUE)
		return scan_value(scan);
	if (scan->offset < scan->length && scan->data[scan->offset] == '}') {
		scan->offset++;
		return close_container(scan);
	}
	if (scan->offset >= scan->length || scan->data[scan->offset++] != ',')
		return reject_malformed(scan);
	frame->state = OBJECT_KEY;
	return true;
}

static void cleanup(struct canonical_scan *scan)
{
	for (size_t i = 0; i < scan->frame_count; i++)
		free_frame(&scan->frames[i]);
}

bool z2m_canonical_validate(const unsigned char *data, size_t length,
	struct z2m_canonical_error *error)
{
	struct canonical_scan scan = {
		.data = data,
		.length = length,
		.error = error
	};
	bool valid = true;

	if (error == NULL)
		return false;
	error->code = NULL;
	error->stage = NULL;
	if ((data == NULL && length != 0) || !valid_utf8(data, length))
		return reject(&scan, "EMALFORMED", "utf8");
	while (!scan.root_complete && valid) {
		if (scan.frame_count == 0)
			valid = scan_value(&scan);
		else {
			struct canonical_frame *frame = &scan.frames[scan.frame_count - 1];
			valid = frame->type == FRAME_ARRAY ?
				scan_array_frame(&scan, frame) : scan_object_frame(&scan, frame);
		}
	}
	if (valid) {
		skip_whitespace(&scan);
		if (scan.offset != scan.length)
			valid = reject(&scan, "EMALFORMED", "trailing_data");
	}
	cleanup(&scan);
	return valid;
}

struct semantic_counts {
	size_t containers;
	size_t members;
	size_t nodes;
};

static bool semantic_node_valid(json_object *value, size_t depth,
	struct semantic_counts *counts)
{
	enum json_type type = value == NULL ? json_type_null :
		json_object_get_type(value);

	if (depth > Z2M_CANONICAL_MAX_DEPTH ||
		counts->nodes >= Z2M_CANONICAL_MAX_NODES)
		return false;
	counts->nodes++;
	switch (type) {
	case json_type_null:
	case json_type_boolean:
		return true;
	case json_type_int:
		(void)json_object_get_int64(value);
		return json_object_get_uint64(value) <= INT64_MAX;
	case json_type_string: {
		int length = json_object_get_string_len(value);
		return length >= 0 && (length == 0 || json_object_get_string(value) != NULL);
	}
	case json_type_array: {
		size_t length;

		if (counts->containers >= Z2M_CANONICAL_MAX_CONTAINERS)
			return false;
		counts->containers++;
		length = json_object_array_length(value);
		for (size_t i = 0; i < length; i++)
			if (!semantic_node_valid(json_object_array_get_idx(value, i),
				depth + 1U, counts))
				return false;
		return true;
	}
	case json_type_object: {
		size_t length;

		if (counts->containers >= Z2M_CANONICAL_MAX_CONTAINERS)
			return false;
		counts->containers++;
		length = json_object_object_length(value);
		if (length > Z2M_CANONICAL_MAX_MEMBERS - counts->members)
			return false;
		counts->members += length;
		json_object_object_foreach(value, key, child) {
			if (strlen(key) > Z2M_CANONICAL_MAX_KEY_BYTES ||
				!semantic_node_valid(child, depth + 1U, counts))
				return false;
		}
		return true;
	}
	case json_type_double:
	default:
		return false;
	}
}

bool z2m_canonical_semantic_valid(json_object *value)
{
	struct semantic_counts counts = {0};

	return semantic_node_valid(value, 1U, &counts);
}

static void append_hex_quad(unsigned char **output, uint32_t value)
{
	static const unsigned char digits[] = "0123456789abcdef";

	*(*output)++ = '\\';
	*(*output)++ = 'u';
	for (unsigned int shift = 12U;; shift -= 4U) {
		*(*output)++ = digits[(value >> shift) & 0x0fU];
		if (shift == 0)
			break;
	}
}

static unsigned char *json_c_input(const unsigned char *data, size_t length,
	size_t *output_length)
{
	size_t required = length;
	size_t offset = 0;
	unsigned char *copy;
	unsigned char *output;

	while (offset < length) {
		size_t start = offset;
		uint32_t codepoint;
		size_t escaped;

		if (data[offset] < 0x80U) {
			offset++;
			continue;
		}
		if (!decode_utf8(data, length, &offset, &codepoint))
			return NULL;
		escaped = codepoint <= 0xffffU ? 6U : 12U;
		if (escaped - (offset - start) > SIZE_MAX - required)
			return NULL;
		required += escaped - (offset - start);
	}
	if (required >= (size_t)INT_MAX)
		return NULL;
	copy = z2m_alloc(required + 1U);
	if (copy == NULL)
		return NULL;
	output = copy;
	offset = 0;
	while (offset < length) {
		uint32_t codepoint;

		if (data[offset] < 0x80U) {
			*output++ = data[offset++];
			continue;
		}
		if (!decode_utf8(data, length, &offset, &codepoint)) {
			free(copy);
			return NULL;
		}
		if (codepoint <= 0xffffU) {
			append_hex_quad(&output, codepoint);
		} else {
			uint32_t pair = codepoint - 0x10000U;
			append_hex_quad(&output, 0xd800U + (pair >> 10));
			append_hex_quad(&output, 0xdc00U + (pair & 0x3ffU));
		}
	}
	*output = '\0';
	*output_length = required;
	return copy;
}

bool z2m_json_c_parse_validated(const unsigned char *data, size_t length,
	unsigned int max_depth, json_object **value)
{
	json_tokener *tokener;
	json_object *parsed;
	enum json_tokener_error tokener_error;
	unsigned char *input;
	size_t input_length;

	if (value == NULL || max_depth > (unsigned int)INT_MAX)
		return false;
	*value = NULL;
	input = json_c_input(data, length, &input_length);
	if (input == NULL)
		return false;
	tokener = json_tokener_new_ex((int)max_depth);
	if (tokener == NULL) {
		free(input);
		return false;
	}
	json_tokener_set_flags(tokener, JSON_TOKENER_STRICT);
	parsed = json_tokener_parse_ex(tokener, (const char *)input,
		(int)input_length + 1);
	tokener_error = json_tokener_get_error(tokener);
	json_tokener_free(tokener);
	free(input);
	if (tokener_error != json_tokener_success) {
		json_object_put(parsed);
		return false;
	}
	*value = parsed;
	return true;
}

bool z2m_canonical_construct(const unsigned char *data, size_t length,
	json_object **value, struct z2m_canonical_error *error)
{
	json_object *parsed;

	if (value == NULL || error == NULL)
		return false;
	*value = NULL;
	if (!z2m_canonical_validate(data, length, error))
		return false;
	if (!z2m_json_c_parse_validated(data, length,
		Z2M_CANONICAL_MAX_DEPTH + 1U, &parsed) ||
		!z2m_canonical_semantic_valid(parsed)) {
		json_object_put(parsed);
		error->code = "EINTERNAL";
		error->stage = "canonical_encode";
		return false;
	}
	*value = parsed;
	return true;
}

struct encode_member {
	const char *key;
	size_t key_length;
	json_object *value;
};

struct encode_frame {
	json_object *value;
	enum json_type type;
	size_t index;
	size_t count;
	size_t member_start;
	bool opened;
};

struct canonical_encoder {
	unsigned char *output;
	size_t length;
	size_t capacity;
	struct encode_frame *frames;
	size_t frame_count;
	struct encode_member *members;
	size_t member_count;
	size_t containers;
	size_t nodes;
	struct z2m_canonical_error *error;
};

static bool encode_reject(struct canonical_encoder *encoder, const char *code,
	const char *stage)
{
	encoder->error->code = code;
	encoder->error->stage = stage;
	return false;
}

static bool encode_internal(struct canonical_encoder *encoder)
{
	return encode_reject(encoder, "EINTERNAL", "canonical_encode");
}

static bool encode_reserve(struct canonical_encoder *encoder, size_t addition)
{
	size_t required;
	size_t next;
	unsigned char *grown;

	if (addition > Z2M_CANONICAL_MAX_BYTES - encoder->length)
		return encode_reject(encoder, "ETOOBIG", "canonical_size");
	required = encoder->length + addition;
	if (required <= encoder->capacity)
		return true;
	next = encoder->capacity;
	while (next < required) {
		if (next > Z2M_CANONICAL_MAX_BYTES / 2U)
			next = Z2M_CANONICAL_MAX_BYTES;
		else
			next += next;
	}
	grown = z2m_realloc(encoder->output, next);
	if (grown == NULL)
		return encode_internal(encoder);
	encoder->output = grown;
	encoder->capacity = next;
	return true;
}

static bool encode_append(struct canonical_encoder *encoder,
	const unsigned char *data, size_t length)
{
	if (!encode_reserve(encoder, length))
		return false;
	if (length != 0)
		memcpy(encoder->output + encoder->length, data, length);
	encoder->length += length;
	return true;
}

static bool encode_byte(struct canonical_encoder *encoder, unsigned char byte)
{
	return encode_append(encoder, &byte, 1U);
}

static bool encode_string(struct canonical_encoder *encoder,
	const unsigned char *value, size_t length)
{
	static const unsigned char digits[] = "0123456789abcdef";

	if (!encode_byte(encoder, '"'))
		return false;
	for (size_t i = 0; i < length; i++) {
		unsigned char byte = value[i];
		unsigned char escape[6];
		unsigned char named = 0;

		if (byte == '"' || byte == '\\') {
			escape[0] = '\\';
			escape[1] = byte;
			if (!encode_append(encoder, escape, 2U))
				return false;
			continue;
		}
		switch (byte) {
		case '\b': named = 'b'; break;
		case '\t': named = 't'; break;
		case '\n': named = 'n'; break;
		case '\f': named = 'f'; break;
		case '\r': named = 'r'; break;
		default: break;
		}
		if (named != 0) {
			escape[0] = '\\';
			escape[1] = named;
			if (!encode_append(encoder, escape, 2U))
				return false;
		} else if (byte < 0x20U) {
			escape[0] = '\\';
			escape[1] = 'u';
			escape[2] = '0';
			escape[3] = '0';
			escape[4] = digits[byte >> 4];
			escape[5] = digits[byte & 0x0fU];
			if (!encode_append(encoder, escape, sizeof(escape)))
				return false;
		} else if (!encode_byte(encoder, byte)) {
			return false;
		}
	}
	return encode_byte(encoder, '"');
}

static bool encode_integer(struct canonical_encoder *encoder, int64_t value)
{
	unsigned char buffer[21];
	unsigned char *cursor = buffer + sizeof(buffer);
	uint64_t magnitude = value < 0 ? (uint64_t)(-(value + 1)) + 1U :
		(uint64_t)value;

	do {
		*--cursor = (unsigned char)('0' + magnitude % 10U);
		magnitude /= 10U;
	} while (magnitude != 0);
	if (value < 0)
		*--cursor = '-';
	return encode_append(encoder, cursor,
		(size_t)(buffer + sizeof(buffer) - cursor));
}

static int compare_encode_members(const void *left_value,
	const void *right_value)
{
	const struct encode_member *left = left_value;
	const struct encode_member *right = right_value;
	size_t common = left->key_length < right->key_length ? left->key_length :
		right->key_length;
	int compared = common == 0 ? 0 : memcmp(left->key, right->key, common);

	if (compared != 0)
		return compared;
	return left->key_length < right->key_length ? -1 :
		left->key_length > right->key_length;
}

static bool encode_push(struct canonical_encoder *encoder, json_object *value)
{
	struct encode_frame *frame;
	enum json_type type = value == NULL ? json_type_null :
		json_object_get_type(value);

	if (encoder->frame_count >= Z2M_CANONICAL_MAX_DEPTH ||
		encoder->nodes >= Z2M_CANONICAL_MAX_NODES)
		return encode_internal(encoder);
	if (type != json_type_null && type != json_type_boolean &&
		type != json_type_int && type != json_type_string &&
		type != json_type_array && type != json_type_object)
		return encode_internal(encoder);
	if ((type == json_type_array || type == json_type_object) &&
		encoder->containers >= Z2M_CANONICAL_MAX_CONTAINERS)
		return encode_internal(encoder);
	encoder->nodes++;
	if (type == json_type_array || type == json_type_object)
		encoder->containers++;
	frame = &encoder->frames[encoder->frame_count++];
	memset(frame, 0, sizeof(*frame));
	frame->value = value;
	frame->type = type;
	return true;
}

static bool encode_open_object(struct canonical_encoder *encoder,
	struct encode_frame *frame)
{
	size_t count = json_object_object_length(frame->value);

	if (count > Z2M_CANONICAL_MAX_MEMBERS - encoder->member_count)
		return encode_internal(encoder);
	frame->member_start = encoder->member_count;
	frame->count = count;
	json_object_object_foreach(frame->value, key, child) {
		size_t key_length = strlen(key);
		struct encode_member *member;

		if (key_length > Z2M_CANONICAL_MAX_KEY_BYTES ||
			encoder->member_count >= Z2M_CANONICAL_MAX_MEMBERS)
			return encode_internal(encoder);
		member = &encoder->members[encoder->member_count++];
		member->key = key;
		member->key_length = key_length;
		member->value = child;
	}
	if (encoder->member_count - frame->member_start != count)
		return encode_internal(encoder);
	if (count > 1U)
		qsort(encoder->members + frame->member_start, count,
			sizeof(*encoder->members), compare_encode_members);
	frame->opened = true;
	return encode_byte(encoder, '{');
}

static bool encode_scalar(struct canonical_encoder *encoder,
	struct encode_frame *frame)
{
	switch (frame->type) {
	case json_type_null:
		return encode_append(encoder, (const unsigned char *)"null", 4U);
	case json_type_boolean:
		if (json_object_get_boolean(frame->value))
			return encode_append(encoder, (const unsigned char *)"true", 4U);
		return encode_append(encoder, (const unsigned char *)"false", 5U);
	case json_type_int:
		if (json_object_get_uint64(frame->value) > INT64_MAX)
			return encode_internal(encoder);
		return encode_integer(encoder, json_object_get_int64(frame->value));
	case json_type_string: {
		int length = json_object_get_string_len(frame->value);
		const char *value = json_object_get_string(frame->value);

		if (length < 0 || (length != 0 && value == NULL))
			return encode_internal(encoder);
		return encode_string(encoder, (const unsigned char *)value,
			(size_t)length);
	}
	default:
		return encode_internal(encoder);
	}
}

static bool encode_value(struct canonical_encoder *encoder)
{
	while (encoder->frame_count != 0) {
		struct encode_frame *frame =
			&encoder->frames[encoder->frame_count - 1U];

		if (frame->type != json_type_array && frame->type != json_type_object) {
			if (!encode_scalar(encoder, frame))
				return false;
			encoder->frame_count--;
			continue;
		}
		if (!frame->opened) {
			if (frame->type == json_type_object) {
				if (!encode_open_object(encoder, frame))
					return false;
			} else {
				frame->count = json_object_array_length(frame->value);
				frame->opened = true;
				if (!encode_byte(encoder, '['))
					return false;
			}
			continue;
		}
		if (frame->index == frame->count) {
			if (!encode_byte(encoder,
				frame->type == json_type_object ? '}' : ']'))
				return false;
			encoder->frame_count--;
			continue;
		}
		if (frame->index != 0 && !encode_byte(encoder, ','))
			return false;
		if (frame->type == json_type_array) {
			json_object *child = json_object_array_get_idx(frame->value,
				frame->index++);
			if (!encode_push(encoder, child))
				return false;
		} else {
			struct encode_member *member = &encoder->members[
				frame->member_start + frame->index++];
			if (!encode_string(encoder, (const unsigned char *)member->key,
				member->key_length) || !encode_byte(encoder, ':') ||
				!encode_push(encoder, member->value))
				return false;
		}
	}
	return true;
}

bool z2m_canonical_encode(json_object *value, unsigned char **output,
	size_t *length, struct z2m_canonical_error *error)
{
	struct canonical_encoder encoder = {.error = error};
	const size_t initial_capacity = 256U;
	bool encoded;

	if (output == NULL || length == NULL || error == NULL)
		return false;
	*output = NULL;
	*length = 0;
	error->code = NULL;
	error->stage = NULL;
	if (Z2M_CANONICAL_MAX_DEPTH > SIZE_MAX / sizeof(*encoder.frames) ||
		Z2M_CANONICAL_MAX_MEMBERS > SIZE_MAX / sizeof(*encoder.members))
		return encode_internal(&encoder);
	encoder.output = z2m_alloc(initial_capacity);
	if (encoder.output == NULL)
		return encode_internal(&encoder);
	encoder.capacity = initial_capacity;
	encoder.frames = z2m_alloc(Z2M_CANONICAL_MAX_DEPTH *
		sizeof(*encoder.frames));
	if (encoder.frames == NULL) {
		free(encoder.output);
		return encode_internal(&encoder);
	}
	encoder.members = z2m_alloc(Z2M_CANONICAL_MAX_MEMBERS *
		sizeof(*encoder.members));
	if (encoder.members == NULL) {
		free(encoder.frames);
		free(encoder.output);
		return encode_internal(&encoder);
	}
	encoded = encode_push(&encoder, value) && encode_value(&encoder);
	free(encoder.members);
	free(encoder.frames);
	if (!encoded) {
		free(encoder.output);
		return false;
	}
	*output = encoder.output;
	*length = encoder.length;
	return true;
}
