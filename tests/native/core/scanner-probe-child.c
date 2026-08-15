#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv)
{
	const char *host = "";
	for (int i = 1; i < argc; i++) {
		if (strstr(argv[i], "sleep") || strstr(argv[i], "fail") || strstr(argv[i], "stun") || strstr(argv[i], "example.com")) {
			host = argv[i];
			break;
		}
	}
	const char *mode = strstr(host, "sleep") ? "sleep" : (strstr(host, "fail") ? "fail" : (strstr(host, "stun") ? "stun" : "http"));
	{
		FILE *file = fopen("/tmp/z2m-scanner-probe-argv.log", "a");
		if (!file) return 90;
		for (int i = 0; i < argc; i++) fprintf(file, "%s\n", argv[i]);
		fclose(file);
	}
	if (mode && !strcmp(mode, "sleep")) { sleep(30); return 0; }
	if (mode && !strcmp(mode, "fail")) { fputs("partial", stdout); fflush(stdout); return 7; }
	if (mode && !strcmp(mode, "http")) {
		fputs("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n", stdout);
		return 0;
	}
	if (mode && !strcmp(mode, "stun")) {
		unsigned char packet[] = {1,1,0,12,0x21,0x12,0xa4,0x42,1,2,3,4,5,6,7,8,9,10,11,12,0,0x20,0,8,0,1,0x30,0x35,0xe1,0x12,0xa6,0x43};
		return write(STDOUT_FILENO, packet, sizeof(packet)) == (ssize_t)sizeof(packet) ? 0 : 91;
	}
	return 0;
}
