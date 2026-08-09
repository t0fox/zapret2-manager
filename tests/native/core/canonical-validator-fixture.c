#include "helper.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void *tracked_allocations[16];
static size_t tracked_count;
static long allocation_count;

static bool allocation_should_fail(void)
{
	const char *value = getenv("Z2M_TEST_ALLOC_FAIL_AFTER");

	return value != NULL && ++allocation_count >= strtol(value, NULL, 10);
}

static void track(void *pointer)
{
	if (pointer == NULL)
		return;
	if (tracked_count >= sizeof(tracked_allocations) /
		sizeof(tracked_allocations[0])) {
		fprintf(stderr, "allocation tracker overflow\n");
		exit(70);
	}
	tracked_allocations[tracked_count++] = pointer;
}

void *z2m_alloc(size_t size)
{
	void *pointer;

	if (allocation_should_fail())
		return NULL;
	pointer = malloc(size);
	track(pointer);
	return pointer;
}

void *z2m_realloc(void *pointer, size_t size)
{
	void *grown;
	size_t tracked = tracked_count;

	if (allocation_should_fail())
		return NULL;
	for (size_t i = 0; i < tracked_count; i++)
		if (tracked_allocations[i] == pointer) {
			tracked = i;
			break;
		}
	grown = realloc(pointer, size);
	if (grown == NULL)
		return NULL;
	if (tracked < tracked_count) {
		tracked_allocations[tracked] = grown;
		return grown;
	}
	track(grown);
	return grown;
}

void __real_free(void *pointer);

void __wrap_free(void *pointer)
{
	for (size_t i = 0; i < tracked_count; i++) {
		if (tracked_allocations[i] == pointer) {
			tracked_allocations[i] = tracked_allocations[--tracked_count];
			break;
		}
	}
	__real_free(pointer);
}

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
	unsigned char *output = NULL;
	size_t output_length = 0;
	size_t length;
	int result = 0;

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
	} else if (argc == 2 && strcmp(argv[1], "encode") == 0) {
		if (!z2m_canonical_construct(input, length, &value, &error) ||
			!z2m_canonical_encode(value, &output, &output_length, &error))
			printf("%s %s\n", error.code, error.stage);
		else if (fwrite(output, 1, output_length, stdout) != output_length)
			result = 70;
		free(output);
		json_object_put(value);
	} else if (argc != 1) {
		free(input);
		return 64;
	} else if (z2m_canonical_validate(input, length, &error))
		puts("VALID");
	else
		printf("%s %s\n", error.code, error.stage);
	free(input);
	if (tracked_count != 0) {
		fprintf(stderr, "encoder leaked %zu allocation(s)\n", tracked_count);
		return 70;
	}
	return result;
}
