#include "helper.h"

#include <stdio.h>
#include <stdlib.h>

int main(void)
{
	unsigned char *input = malloc(Z2M_REQUEST_MAX);
	struct z2m_canonical_error error = {0};
	size_t length;

	if (input == NULL)
		return 70;
	length = fread(input, 1, Z2M_REQUEST_MAX, stdin);
	if (ferror(stdin)) {
		free(input);
		return 70;
	}
	if (z2m_canonical_validate(input, length, &error))
		puts("VALID");
	else
		printf("%s %s\n", error.code, error.stage);
	free(input);
	return 0;
}
