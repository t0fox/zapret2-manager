#include <signal.h>
#include <stdlib.h>
#include <unistd.h>

int main(void) {
#if defined(Z2M_SCENARIO_HEAP_OVERFLOW)
	volatile int index = 1;
	char *value = malloc(1);
	if (value == NULL)
		return 2;
	value[index] = 'x';
	free(value);
	return 0;
#elif defined(Z2M_SCENARIO_TIMEOUT)
	for (;;)
		pause();
#elif defined(Z2M_SCENARIO_SIGNAL)
	raise(SIGTERM);
	return 0;
#elif defined(Z2M_SCENARIO_ABNORMAL_EXIT)
	return 17;
#elif defined(Z2M_SCENARIO_EXIT_130)
	return 130;
#elif defined(Z2M_SCENARIO_STDOUT_MARKER)
	(void)!write(STDOUT_FILENO, "AddressSanitizer is just text\n", 30);
	return 19;
#elif defined(Z2M_PROBE_CRASH)
	raise(SIGSEGV);
	return 0;
#elif defined(Z2M_PROBE_TIMEOUT)
	for (;;)
		pause();
#else
	return 0;
#endif
}
