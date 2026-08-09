#include <json-c/json.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

struct sample {
	const char *id;
	const unsigned char *bytes;
	size_t length;
};

static void print_json_bytes(const unsigned char *bytes, size_t length)
{
	putchar('"');
	for (size_t i = 0; i < length; i++) {
		unsigned char c = bytes[i];
		if (c == '"' || c == '\\')
			printf("\\%c", c);
		else if (c == '\b')
			fputs("\\b", stdout);
		else if (c == '\f')
			fputs("\\f", stdout);
		else if (c == '\n')
			fputs("\\n", stdout);
		else if (c == '\r')
			fputs("\\r", stdout);
		else if (c == '\t')
			fputs("\\t", stdout);
		else if (c < 0x20 || c >= 0x80)
			printf("\\u%04x", c);
		else
			putchar(c);
	}
	putchar('"');
}

static void print_hex(const unsigned char *bytes, size_t length)
{
	static const char hex[] = "0123456789abcdef";
	for (size_t i = 0; i < length; i++)
		printf("%c%c", hex[bytes[i] >> 4], hex[bytes[i] & 15]);
}

static void print_sample(const struct sample *sample)
{
	json_tokener *tokener = json_tokener_new();
	json_object *value;
	enum json_tokener_error error;
	printf("{\"id\":");
	print_json_bytes((const unsigned char *)sample->id, strlen(sample->id));
	printf(",\"rawHex\":\"");
	print_hex(sample->bytes, sample->length);
	printf("\",\"inputLength\":%zu", sample->length);
	if (tokener == NULL) {
		fputs(",\"status\":\"internal\"}\n", stdout);
		return;
	}
	json_tokener_set_flags(tokener, JSON_TOKENER_STRICT);
	value = json_tokener_parse_ex(tokener, (const char *)sample->bytes,
		sample->length > (size_t)INT_MAX ? INT_MAX : (int)sample->length);
	error = json_tokener_get_error(tokener);
	printf(",\"status\":\"%s\"", value != NULL && error == json_tokener_success ? "accepted" : "rejected");
	printf(",\"error\":");
	print_json_bytes((const unsigned char *)json_tokener_error_desc(error), strlen(json_tokener_error_desc(error)));
	if (value != NULL && error == json_tokener_success) {
		const char *serialized = json_object_to_json_string_ext(value, JSON_C_TO_STRING_PLAIN);
		const char *string_value;
		printf(",\"type\":");
		print_json_bytes((const unsigned char *)json_type_to_name(json_object_get_type(value)),
			strlen(json_type_to_name(json_object_get_type(value))));
		printf(",\"serialized\":");
		print_json_bytes((const unsigned char *)serialized, strlen(serialized));
		if (json_object_is_type(value, json_type_string)) {
			string_value = json_object_get_string(value);
			printf(",\"stringLength\":%d,\"stringHex\":\"", json_object_get_string_len(value));
			print_hex((const unsigned char *)string_value, (size_t)json_object_get_string_len(value));
			fputs("\"", stdout);
		}
	}
	json_object_put(value);
	json_tokener_free(tokener);
	puts("}");
}

int main(void)
{
	static const unsigned char duplicate[] = "{\"a\":1,\"a\":2}";
	static const unsigned char integer[] = "{\"v\":1}";
	static const unsigned char negative_zero[] = "{\"v\":-0}";
	static const unsigned char exponent[] = "{\"v\":1e0}";
	static const unsigned char decimal[] = "{\"v\":1.0}";
	static const unsigned char overflow[] = "{\"v\":9223372036854775808}";
	static const unsigned char escaped[] = "\"\\u0061\"";
	static const unsigned char plain[] = "\"a\"";
	static const unsigned char pair[] = "\"\\ud83d\\ude00\"";
	static const unsigned char high[] = "\"\\ud83d\"";
	static const unsigned char low[] = "\"\\ude00\"";
	static const unsigned char invalid_utf8[] = {'"', 0xff, '"'};
	static const unsigned char raw_nul[] = {'"', 0x00, '"'};
	static const unsigned char escaped_nul[] = "\"\\u0000\"";
	static const unsigned char escaped_nul_key[] = "{\"\\u0000\":1}";
	static const struct sample samples[] = {
		{"duplicate_keys", duplicate, sizeof(duplicate) - 1},
		{"lexical_integer", integer, sizeof(integer) - 1},
		{"negative_zero", negative_zero, sizeof(negative_zero) - 1},
		{"exponent_number", exponent, sizeof(exponent) - 1},
		{"decimal_number", decimal, sizeof(decimal) - 1},
		{"integer_overflow", overflow, sizeof(overflow) - 1},
		{"unicode_escape", escaped, sizeof(escaped) - 1},
		{"plain_string", plain, sizeof(plain) - 1},
		{"surrogate_pair", pair, sizeof(pair) - 1},
		{"lone_high_surrogate", high, sizeof(high) - 1},
		{"lone_low_surrogate", low, sizeof(low) - 1},
		{"invalid_utf8", invalid_utf8, sizeof(invalid_utf8)},
		{"raw_embedded_nul", raw_nul, sizeof(raw_nul)},
		{"escaped_nul", escaped_nul, sizeof(escaped_nul) - 1},
		{"escaped_nul_key", escaped_nul_key, sizeof(escaped_nul_key) - 1},
	};
	for (size_t i = 0; i < sizeof(samples) / sizeof(samples[0]); i++)
		print_sample(&samples[i]);
	return 0;
}
