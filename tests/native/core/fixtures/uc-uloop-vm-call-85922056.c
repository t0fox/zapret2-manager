/* Exact excerpt from ucode commit 85922056ef7abeace3cca3ab28bc1ac2d88e31b1,
 * lib/uloop.c. Preserved for static review of OpenWrt patch 111. */
static bool
uc_uloop_vm_call(uc_vm_t *vm, bool mcall, size_t nargs)
{
	uc_value_t *exh, *val;

	if (uc_vm_call(vm, mcall, nargs) == EXCEPTION_NONE)
		return true;

	exh = uc_vm_registry_get(vm, "uloop.ex_handler");
	if (!ucv_is_callable(exh))
		goto error;

	val = uc_vm_exception_object(vm);
	uc_vm_stack_push(vm, ucv_get(exh));
	uc_vm_stack_push(vm, val);

	if (uc_vm_call(vm, false, 1) != EXCEPTION_NONE)
		goto error;

	ucv_put(uc_vm_stack_pop(vm));

	return false;

error:
	uloop_end();
	return false;
}
