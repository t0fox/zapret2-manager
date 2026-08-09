#include "helper.h"

/*
 * This fixture exists only to assert that the shared atomic byte publication
 * engine z2m_atomic_write_bytes() is a real, linkable production symbol with
 * the wished-for interface: it borrows payload bytes/length and receives the
 * request, root, root fd, path, and allow-create. It decodes nothing and owns
 * no payload. The fixture is never executed; it only has to compile and link
 * against the production atomic.c translation unit.
 */
int main(void)
{
	const struct z2m_request *request = 0;
	const struct z2m_root *root = 0;
	const unsigned char *content = 0;
	int (*engine)(const struct z2m_request *, const struct z2m_root *, int,
		const char *, const unsigned char *, size_t, bool) =
		z2m_atomic_write_bytes;
	return engine(request, root, -1, "", content, 0, false);
}
