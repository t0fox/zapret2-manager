#include "helper.h"

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
	return reject(scan, "EINTERNAL", "internal");
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
		grown = realloc(key->data, next);
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
		next = frame->key_capacity == 0 ? 8U : frame->key_capacity * 2U;
		if (next > Z2M_CANONICAL_MAX_MEMBERS)
			next = Z2M_CANONICAL_MAX_MEMBERS;
		if (next > SIZE_MAX / sizeof(*grown)) {
			free(key->data);
			key->data = NULL;
			return reject_internal(scan);
		}
		grown = realloc(frame->keys, next * sizeof(*grown));
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
