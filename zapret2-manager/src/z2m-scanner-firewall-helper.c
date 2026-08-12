#include <errno.h>
#include <fcntl.h>
#include <json-c/json.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <limits.h>

#define TABLE "zapret2"
#define CHAIN "z2m_scanner"
#define QUEUE "300"
#define OPERATION "compare_delete"
#define NFT_PRODUCTION "/usr/sbin/nft"
#define ROOT_PRODUCTION "/tmp/zapret2-manager"
#define LOCK_PRODUCTION "/tmp/zapret2-manager/scanner/firewall.lock"
#define EVIDENCE_PRODUCTION "/tmp/zapret2-manager/scanner/firewall-helper.evidence"
#define MAX_REQUEST (64U * 1024U)
#define MAX_CHAIN (1024U * 1024U)

#ifdef Z2M_SCANNER_HELPER_TEST
#define NFT_PATH Z2M_SCANNER_NFT_PATH
#define ROOT_PATH Z2M_SCANNER_ROOT_PATH
#define LOCK_PATH Z2M_SCANNER_LOCK_PATH
#define EVIDENCE_PATH Z2M_SCANNER_EVIDENCE_PATH
#else
#define NFT_PATH NFT_PRODUCTION
#define ROOT_PATH ROOT_PRODUCTION
#define LOCK_PATH LOCK_PRODUCTION
#define EVIDENCE_PATH EVIDENCE_PRODUCTION
#endif

#ifdef Z2M_SCANNER_HELPER_TEST
static uid_t expected_uid(void)
{
	return getuid();
}

static gid_t expected_gid(void)
{
	return getgid();
}
#endif

struct request {
	char session[129];
	char candidate[129];
	char marker[512];
	char ownership_token[512];
	char nonce[65];
	char expected_digest[65];
	int64_t generation;
};

#ifdef Z2M_SCANNER_HELPER_TEST
struct sha256 {
	uint32_t state[8];
	uint64_t length;
	unsigned char block[64];
	size_t used;
};

static uint32_t rotate_right(uint32_t value, unsigned int count)
{ return (value >> count) | (value << (32U - count)); }

static void sha_transform(struct sha256 *ctx, const unsigned char block[64])
{
	static const uint32_t k[64] = {
		0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
		0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
		0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
		0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
		0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
		0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
		0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
		0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,
		0xc67178f2
	};
	uint32_t w[64], a, b, c, d, e, f, g, h;
	for (size_t i = 0; i < 16; i++)
		w[i] = ((uint32_t)block[i * 4] << 24) | ((uint32_t)block[i * 4 + 1] << 16) |
			((uint32_t)block[i * 4 + 2] << 8) | block[i * 4 + 3];
	for (size_t i = 16; i < 64; i++) {
		uint32_t s0 = rotate_right(w[i - 15], 7) ^ rotate_right(w[i - 15], 18) ^ (w[i - 15] >> 3);
		uint32_t s1 = rotate_right(w[i - 2], 17) ^ rotate_right(w[i - 2], 19) ^ (w[i - 2] >> 10);
		w[i] = w[i - 16] + s0 + w[i - 7] + s1;
	}
	a = ctx->state[0]; b = ctx->state[1]; c = ctx->state[2]; d = ctx->state[3];
	e = ctx->state[4]; f = ctx->state[5]; g = ctx->state[6]; h = ctx->state[7];
	for (size_t i = 0; i < 64; i++) {
		uint32_t s1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
		uint32_t choice = (e & f) ^ ((~e) & g);
		uint32_t t1 = h + s1 + choice + k[i] + w[i];
		uint32_t s0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
		uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
		uint32_t t2 = s0 + majority;
		h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
	}
	ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
	ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void sha_update(struct sha256 *ctx, const unsigned char *data, size_t length)
{
	ctx->length += length;
	while (length > 0) {
		size_t take = 64 - ctx->used;
		if (take > length) take = length;
		memcpy(ctx->block + ctx->used, data, take);
		ctx->used += take; data += take; length -= take;
		if (ctx->used == 64) { sha_transform(ctx, ctx->block); ctx->used = 0; }
	}
}

static void sha_finish(struct sha256 *ctx, char output[65])
{
	unsigned char digest[32];
	uint64_t bits = ctx->length * 8;
	ctx->block[ctx->used++] = 0x80;
	if (ctx->used > 56) { memset(ctx->block + ctx->used, 0, 64 - ctx->used); sha_transform(ctx, ctx->block); ctx->used = 0; }
	memset(ctx->block + ctx->used, 0, 56 - ctx->used);
	for (size_t i = 0; i < 8; i++) ctx->block[63 - i] = (unsigned char)(bits >> (i * 8));
	sha_transform(ctx, ctx->block);
	for (size_t i = 0; i < 8; i++) {
		digest[i * 4] = (unsigned char)(ctx->state[i] >> 24);
		digest[i * 4 + 1] = (unsigned char)(ctx->state[i] >> 16);
		digest[i * 4 + 2] = (unsigned char)(ctx->state[i] >> 8);
		digest[i * 4 + 3] = (unsigned char)ctx->state[i];
	}
	for (size_t i = 0; i < sizeof(digest); i++) snprintf(output + i * 2, 3, "%02x", digest[i]);
	output[64] = '\0';
}
#endif

#ifdef Z2M_SCANNER_HELPER_TEST
static bool valid_hex(const char *value, size_t length)
{
	if (strlen(value) != length) return false;
	for (size_t i = 0; i < length; i++) if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return false;
	return true;
}

static bool valid_id(const char *value)
{
	if (*value == '\0' || strlen(value) > 128) return false;
	for (; *value; value++) if (!(('A' <= *value && *value <= 'Z') || ('a' <= *value && *value <= 'z') || ('0' <= *value && *value <= '9') || strchr("._-", *value) != NULL)) return false;
	return true;
}

static bool copy_string(json_object *args, const char *name, char *out, size_t capacity)
{
	json_object *value;
	if (!json_object_object_get_ex(args, name, &value) || !json_object_is_type(value, json_type_string)) return false;
	if ((size_t)json_object_get_string_len(value) >= capacity) return false;
	memcpy(out, json_object_get_string(value), (size_t)json_object_get_string_len(value) + 1);
	return true;
}

static bool exact_fields(json_object *args)
{
	static const char *const names[] = { "candidate", "expectedChainDigest", "generation", "marker", "nonce", "operation", "ownershipToken", "session" };
	size_t count = 0;
	json_object_object_foreach(args, key, value) {
		(void)value;
		bool known = false;
		for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) if (strcmp(key, names[i]) == 0) known = true;
		if (!known) return false;
		count++;
	}
	return count == sizeof(names) / sizeof(names[0]);
}

static bool parse_request(struct request *request)
{
	char buffer[MAX_REQUEST + 1]; size_t used = 0;
	while (used < MAX_REQUEST) {
		ssize_t got = read(STDIN_FILENO, buffer + used, MAX_REQUEST - used);
		if (got < 0 && errno == EINTR) continue;
		if (got <= 0) break;
		used += (size_t)got;
	}
	if (used == MAX_REQUEST) return false;
	buffer[used] = '\0';
	json_tokener *tokener = json_tokener_new();
	if (tokener == NULL) return false;
	json_object *document = json_tokener_parse_ex(tokener, buffer, (int)used);
	bool valid = document != NULL && json_object_is_type(document, json_type_object);
	if (valid) {
		size_t offset = (size_t)tokener->char_offset;
		while (offset < used && (buffer[offset] == ' ' || buffer[offset] == '\t' || buffer[offset] == '\r' || buffer[offset] == '\n')) offset++;
		valid = offset == used;
	}
	if (!valid) { json_tokener_free(tokener); json_object_put(document); return false; }
	json_object *args = document;
	json_object *operation, *generation;
	valid = exact_fields(args) && copy_string(args, "session", request->session, sizeof(request->session)) &&
		copy_string(args, "candidate", request->candidate, sizeof(request->candidate)) &&
		copy_string(args, "marker", request->marker, sizeof(request->marker)) &&
		copy_string(args, "ownershipToken", request->ownership_token, sizeof(request->ownership_token)) &&
		copy_string(args, "nonce", request->nonce, sizeof(request->nonce)) &&
		copy_string(args, "expectedChainDigest", request->expected_digest, sizeof(request->expected_digest)) &&
		json_object_object_get_ex(args, "operation", &operation) && json_object_is_type(operation, json_type_string) &&
		strcmp(json_object_get_string(operation), OPERATION) == 0 &&
		json_object_object_get_ex(args, "generation", &generation) && json_object_is_type(generation, json_type_int);
	if (valid) request->generation = json_object_get_int64(generation);
	if (valid) {
		char expected_marker[512], expected_token[512];
		if (request->generation < 0 || !valid_id(request->session) || !valid_id(request->candidate) ||
			!valid_hex(request->nonce, 64) || !valid_hex(request->expected_digest, 64) ||
			snprintf(expected_marker, sizeof(expected_marker), "z2m-scanner:%s:%s:%lld:%s", request->session, request->candidate, (long long)request->generation, request->nonce) < 0 ||
			snprintf(expected_token, sizeof(expected_token), "scanner-firewall-v1:%s:%s:%lld:%s", request->session, request->candidate, (long long)request->generation, request->nonce) < 0 ||
			strcmp(request->marker, expected_marker) != 0 || strcmp(request->ownership_token, expected_token) != 0) valid = false;
	}
	json_object_put(document); json_tokener_free(tokener); return valid;
}
#endif

static void emit_result(bool ok, const char *code, const char *evidence)
{
	json_object *result = json_object_new_object();
	json_object_object_add(result, "ok", json_object_new_boolean(ok));
	if (!ok) json_object_object_add(result, "code", json_object_new_string(code));
	json_object_object_add(result, "evidence", json_object_new_string(evidence));
	puts(json_object_to_json_string_ext(result, JSON_C_TO_STRING_PLAIN));
	json_object_put(result);
}

#ifdef Z2M_SCANNER_HELPER_TEST
static bool private_directory(const char *path)
{
	struct stat st;
	return lstat(path, &st) == 0 && S_ISDIR(st.st_mode) && st.st_uid == expected_uid() &&
		st.st_gid == expected_gid() && (st.st_mode & 0777) == 0700;
}

static bool write_evidence(const struct request *request, const char *state, const char *observed)
{
	int fd = open(EVIDENCE_PATH, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
	if (fd < 0) return false;
	struct stat file_stat;
	if (fstat(fd, &file_stat) < 0 || !S_ISREG(file_stat.st_mode) || file_stat.st_uid != expected_uid() ||
		file_stat.st_gid != expected_gid() || (file_stat.st_mode & 0777) != 0600 || ftruncate(fd, 0) < 0 || lseek(fd, 0, SEEK_SET) < 0) {
		close(fd); return false;
	}
	char line[2048];
	int length = snprintf(line, sizeof(line), "operation=%s\nsession=%s\ncandidate=%s\ngeneration=%lld\nnonce=%s\nstate=%s\nobservedDigest=%s\n", OPERATION, request->session, request->candidate, (long long)request->generation, request->nonce, state, observed);
	bool ok = length > 0 && (size_t)length < sizeof(line);
	for (int offset = 0; ok && offset < length;) {
		ssize_t written = write(fd, line + offset, (size_t)(length - offset));
		if (written < 0 && errno == EINTR) continue;
		if (written <= 0) { ok = false; break; }
		offset += (int)written;
	}
	if (ok) ok = fsync(fd) == 0;
	close(fd); return ok;
}

static int run_nft(const char *const argv[], char *output, size_t capacity)
{
	int pipefd[2];
	if (pipe(pipefd) < 0) return -1;
	pid_t child = fork();
	if (child < 0) { close(pipefd[0]); close(pipefd[1]); return -1; }
	if (child == 0) {
		int nullfd = open("/dev/null", O_WRONLY | O_CLOEXEC);
		dup2(pipefd[1], STDOUT_FILENO); if (nullfd >= 0) dup2(nullfd, STDERR_FILENO);
		close(pipefd[0]); close(pipefd[1]); if (nullfd >= 0) close(nullfd);
		execv(NFT_PATH, (char *const *)argv); _exit(127);
	}
	close(pipefd[1]); size_t used = 0;
	while (used < capacity) {
		ssize_t got = read(pipefd[0], output + used, capacity - used);
		if (got < 0 && errno == EINTR) continue;
		if (got <= 0) break;
		used += (size_t)got;
	}
	close(pipefd[0]);
	int status; pid_t waited;
	do waited = waitpid(child, &status, 0); while (waited < 0 && errno == EINTR);
	if (waited < 0) return -1;
	if (used == capacity) { output[capacity - 1] = '\0'; return -1; }
	output[used] = '\0';
	return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static size_t occurrences(const char *text, const char *needle)
{
	size_t count = 0; const char *at = text;
	while ((at = strstr(at, needle)) != NULL) { count++; at += strlen(needle); }
	return count;
}
#endif

#ifdef Z2M_SCANNER_HELPER_TEST
static int compare_delete(const struct request *request)
{
	char scanner_root[PATH_MAX];
	if (snprintf(scanner_root, sizeof(scanner_root), "%s/scanner", ROOT_PATH) < 0 ||
		!private_directory(ROOT_PATH) || !private_directory(scanner_root)) {
		emit_result(false, "EOWNERSHIP", "unsafe-runtime-root"); return 1;
	}
	int lock = open(LOCK_PATH, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
	if (lock < 0 || flock(lock, LOCK_EX) < 0) { if (lock >= 0) close(lock); emit_result(false, "ELOCKED", "lock"); return 1; }
	struct stat lock_stat;
	if (fstat(lock, &lock_stat) < 0 || !S_ISREG(lock_stat.st_mode) || lock_stat.st_uid != expected_uid() ||
		lock_stat.st_gid != expected_gid() || (lock_stat.st_mode & 0777) != 0600) {
		write_evidence(request, "unsafe-lock", ""); emit_result(false, "EOWNERSHIP", "unsafe-lock"); close(lock); return 1;
	}
	char chain[MAX_CHAIN + 1], digest[65];
	const char *list[] = { NFT_PATH, "list", "chain", "inet", TABLE, CHAIN, NULL };
	int listed = run_nft(list, chain, MAX_CHAIN);
	struct sha256 ctx = { { 0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19 }, 0, { 0 }, 0 };
	if (listed != 0) { write_evidence(request, "list-failed", ""); emit_result(false, "EOWNERSHIP", "chain-unavailable"); close(lock); return 1; }
	sha_update(&ctx, (const unsigned char *)chain, strlen(chain)); sha_finish(&ctx, digest);
	if (occurrences(chain, request->marker) != 1 || occurrences(chain, "queue num " QUEUE) != 1 || strcmp(digest, request->expected_digest) != 0) {
		write_evidence(request, "ownership-mismatch", digest); emit_result(false, "EOWNERSHIP", "ownership-mismatch"); close(lock); return 1;
	}
	const char *delete_argv[] = { NFT_PATH, "delete", "chain", "inet", TABLE, CHAIN, NULL };
	char ignored[2];
	if (run_nft(delete_argv, ignored, sizeof(ignored)) != 0) {
		write_evidence(request, "delete-uncertain", digest); emit_result(false, "ECLEANUPUNKNOWN", "delete-uncertain"); close(lock); return 1;
	}
	char after[MAX_CHAIN + 1];
	int verified = run_nft(list, after, MAX_CHAIN);
	if (verified != 1 || after[0] != '\0') {
		write_evidence(request, "delete-verification-failed", digest); emit_result(false, "ECLEANUPUNKNOWN", "delete-verification-failed"); close(lock); return 1;
	}
	if (!write_evidence(request, "deleted", digest)) { emit_result(false, "EIO", "evidence-unavailable"); close(lock); return 1; }
	emit_result(true, "", "native-compare-delete"); close(lock); return 0;
}
#endif

int main(void)
{
#ifndef Z2M_SCANNER_HELPER_TEST
	emit_result(false, "EUNSUPPORTED", "atomic-compare-delete-unavailable");
	return 1;
#else
	struct request request = { 0 };
	if (!parse_request(&request)) { emit_result(false, "ESCHEMA", "request"); return 2; }
	return compare_delete(&request);
#endif
}
