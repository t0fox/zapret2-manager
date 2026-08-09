#include "helper.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void print_semantic(json_object *value)
{
	const char *type = value == NULL ? "null" :
		json_type_to_name(json_object_get_type(value));
	const char *encoded = value == NULL ? "null" :
		json_object_to_json_string_ext(value, JSON_C_TO_STRING_PLAIN);

	printf("%s\t%s\n", type, encoded);
}

int main(int argc, char **argv)
{
	unsigned char *input = malloc(Z2M_REQUEST_MAX);
	struct z2m_canonical_error error = {0};
	json_object *value = NULL;
	size_t length;

	if (input == NULL)
		return 70;
	length = fread(input, 1, Z2M_REQUEST_MAX, stdin);
	if (ferror(stdin)) {
		free(input);
		return 70;
	}
	if (argc == 2 && strcmp(argv[1], "double") == 0) {
		value = json_object_new_double(1.0);
		puts(z2m_canonical_semantic_valid(value) ? "VALID" : "REJECTED");
		json_object_put(value);
	} else if (argc == 2 && strcmp(argv[1], "uint64") == 0) {
		value = json_object_new_uint64(UINT64_MAX);
		puts(z2m_canonical_semantic_valid(value) ? "VALID" : "REJECTED");
		json_object_put(value);
	} else if (argc == 2 && strcmp(argv[1], "construct") == 0) {
		if (z2m_canonical_construct(input, length, &value, &error))
			print_semantic(value);
		else
			printf("%s %s\n", error.code, error.stage);
		json_object_put(value);
	} else if (argc != 1) {
		free(input);
		return 64;
	} else if (z2m_canonical_validate(input, length, &error))
		puts("VALID");
	else
		printf("%s %s\n", error.code, error.stage);
	free(input);
	return 0;
}
