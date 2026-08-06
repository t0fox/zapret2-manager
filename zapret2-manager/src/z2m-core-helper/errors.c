#include "helper.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

struct error_info {
	const char *code;
	const char *message;
	bool retryable;
	json_object *committed;
	const char *durability;
	int exit_code;
};

static const struct error_info errors[] = {
	{"EMALFORMED", "Request is not one valid JSON object.", false, NULL, "unchanged", 2},
	{"ESCHEMA", "Request does not match protocol v1.", false, NULL, "unchanged", 2},
	{"EREQUESTTOOBIG", "Request exceeds the wire limit.", false, NULL, "unchanged", 2},
	{"EDENIED", "Operation is denied by root policy.", false, NULL, "unchanged", 3},
	{"EROOT", "Root is unknown or insecure.", false, NULL, "unchanged", 3},
	{"EPATH", "Path is not an allowed canonical relative path.", false, NULL, "unchanged", 3},
	{"EUNSUPPORTED", "Operation is reserved but not implemented in this milestone.", false, NULL, "unchanged", 3},
	{"ENOENT", "Managed object does not exist.", false, NULL, "unchanged", 4},
	{"ENOTREG", "Managed object is not a regular file.", false, NULL, "unchanged", 4},
	{"ESYMLINK", "Symbolic or magic link traversal was refused.", false, NULL, "unchanged", 4},
	{"EXDEV", "Mount or root boundary crossing was refused.", false, NULL, "unchanged", 4},
	{"ETOOBIG", "Managed object exceeds the operation or root limit.", false, NULL, "unchanged", 4},
	{"EIO", "Filesystem operation failed.", false, NULL, "unchanged", 4},
	{"EINTERNAL", "Helper failed internally.", false, NULL, "not_applicable", 70},
	{"EINCOMPLETE", "Helper could not emit one complete response.", false, NULL, "not_applicable", 74}
};

static int emit(json_object *response, int exit_code)
{
	const char *wire = json_object_to_json_string_ext(response, JSON_C_TO_STRING_PLAIN);
	size_t length = strlen(wire);
	if (length + 1 > Z2M_RESPONSE_MAX) {
		json_object_put(response);
		return 74;
	}
	if (write(STDOUT_FILENO, wire, length) != (ssize_t)length ||
	    write(STDOUT_FILENO, "\n", 1) != 1) {
		json_object_put(response);
		return 74;
	}
	json_object_put(response);
	return exit_code;
}

int z2m_fail(const char *request_id, const char *code, const char *stage)
{
	const struct error_info *info = NULL;
	json_object *response = json_object_new_object();
	json_object *error = json_object_new_object();
	size_t i;
	for (i = 0; i < sizeof(errors) / sizeof(errors[0]); i++)
		if (strcmp(errors[i].code, code) == 0)
			info = &errors[i];
	if (info == NULL)
		info = &errors[12];
	json_object_object_add(response, "protocolVersion", json_object_new_int(1));
	json_object_object_add(response, "requestId", request_id == NULL ? NULL : json_object_new_string(request_id));
	json_object_object_add(response, "ok", json_object_new_boolean(false));
	json_object_object_add(error, "code", json_object_new_string(info->code));
	json_object_object_add(error, "message", json_object_new_string(info->message));
	json_object_object_add(error, "retryable", json_object_new_boolean(info->retryable));
	json_object_object_add(error, "committed",
		strcmp(info->code, "EINTERNAL") == 0 || strcmp(info->code, "EINCOMPLETE") == 0
			? NULL : json_object_new_boolean(false));
	json_object_object_add(error, "durability", json_object_new_string(info->durability));
	json_object_object_add(error, "stage", json_object_new_string(stage));
	json_object_object_add(response, "error", error);
	fprintf(stderr, "z2m-core-helper: %s at %s\n", info->code, stage);
	return emit(response, info->exit_code);
}

int z2m_success(const char *request_id, json_object *data)
{
	json_object *response = json_object_new_object();
	json_object_object_add(response, "protocolVersion", json_object_new_int(1));
	json_object_object_add(response, "requestId", json_object_new_string(request_id));
	json_object_object_add(response, "ok", json_object_new_boolean(true));
	json_object_object_add(response, "data", data);
	return emit(response, 0);
}
