#!/bin/sh
set -eu
[ "${Z2M_SYNC_TRACE:-0}" = 1 ] && set -x
SYNC_LOG=${Z2M_SYNC_LOG:-/dev/null}
sync_log() { printf '%s\n' "sync: $*" >> "$SYNC_LOG" 2>/dev/null || true; }

# strategy-runtime-assets-sync.sh — Z2K runtime asset materialization.
#
# Bundled Strategy assets are package-owned inputs for the official nfqws2
# runtime. Existing upstream core Lua is never downgraded by this hook; custom
# Lua/blobs/lists are installed idempotently and are never deleted.
#
# Modes:
#   (no args)   materialize assets into the live engine roots
#   --verify    compare installed copies against the package baseline and
#               print a JSON verdict {ok, files, missing, mismatched};
#               exit non-zero when anything is missing or tampered
#
# Root overrides exist for sandboxed testing; on-target defaults are canonical.

SRC=${Z2M_RUNTIME_ASSETS_SRC:-/usr/share/zapret2-manager/runtime-assets}
PACKAGE_ROOT=${Z2M_RUNTIME_PACKAGE_ROOT:-/usr/share/zapret2-manager}
BASE=${Z2M_RUNTIME_BASE:-/opt/zapret2}
STATE_ROOT=${Z2M_MANAGER_STATE_ROOT:-/etc/zapret2-manager/state}
STATE_DIR="$STATE_ROOT/autocircular"
ETC_ROOT=${Z2M_MANAGER_ETC_ROOT:-/etc/zapret2-manager}
ASSET_ROOT=${Z2M_MANAGER_ASSET_ROOT:-/etc/zapret2-manager/assets}
ACTIVATION_SNAPSHOT=${Z2M_RUNTIME_ACTIVATION_SNAPSHOT:-/etc/zapret2-manager/runtime-assets.snapshot}

runtime_asset_mode() {
	case "$1" in
		*.lua|*.sh) printf '0755' ;;
		*) printf '0644' ;;
	esac
}

# Registry activation is the bridge between the Asset Registry (the canonical
# selected-release store) and the paths consumed by nfqws2.  It deliberately
# lives in this existing runtime sync helper: this is materialization and
# verification, not a second updater.  The coordinator supplies a bounded TSV
# spec with already validated registry paths and runtimeTarget values.
runtime_target_rel() {
	_target="$1"
	case "$_target" in
		/opt/zapret2/*) _rel="${_target#/opt/zapret2/}" ;;
		/runtime-assets/bin/*) _rel="files/fake/${_target#/runtime-assets/bin/}" ;;
		/runtime-assets/lua/*) _rel="lua/${_target#/runtime-assets/lua/}" ;;
		/runtime-assets/lists/*) _rel="lists/${_target#/runtime-assets/lists/}" ;;
		/runtime-assets/ipset/*) _rel="ipset/${_target#/runtime-assets/ipset/}" ;;
		*) return 1 ;;
	esac
	case "$_rel" in
		''|/*|*..*|*\\*) return 1 ;;
	esac
	RUNTIME_TARGET_REL=$_rel
	return 0
}

activation_restore() {
	_records="$1"
	_backup_dir="$2"
	[ -f "$_records" ] || return 1
	while IFS='|' read -r _dest _backup _had; do
		[ -n "$_dest" ] || continue
		if [ "$_had" = 1 ]; then
			mkdir -p "$(dirname "$_dest")"
			cp "$_backup" "$_dest" || return 1
			chmod "$(runtime_asset_mode "$_dest")" "$_dest" || return 1
		else
			rm -f "$_dest"
		fi
	done < "$_records"
	return 0
}

resolver_luaopt() {
	_spec="$1"
	[ -f "$_spec" ] || return 1
	LUAOPT=''
	_lua_count=0
	while IFS='|' read -r _kind _id _type _entry_kind _source _target _sha _order; do
		[ "$_kind" = LUA_INIT ] || continue
		if [ "$_type" = lua ] && [ -z "$_entry_kind" ] && [ -z "$_target" ] && [ -z "$_sha" ] && [ -n "$_source" ]; then
			_target=$_source; _source=''; _entry_kind=lua; _type=lifecycle-managed
		fi
		# Accept the pre-resolver seven-field handoff only for old direct
		# lifecycle specs. New resolver output always carries both type and kind.
		if [ -z "$_order" ] && printf '%s' "$_sha" | grep -Eq '^[0-9]+$'; then
			_order=$_sha; _sha=$_target; _target=$_source; _source=$_entry_kind; _entry_kind=$_type; _type=lifecycle-managed
		fi
		[ "$_type" = lifecycle-managed ] || [ "$_type" = package-static ] || return 1
		[ "$_entry_kind" = lua ] || return 1
		runtime_target_rel "$_target" || return 1
		case "$_target" in /runtime-assets/lua/*) : ;; *) return 1 ;; esac
		LUAOPT="$LUAOPT --lua-init=@\$ZAPRET_BASE/$RUNTIME_TARGET_REL"
		_lua_count=$((_lua_count + 1))
	done < "$_spec"
	[ "$_lua_count" -gt 0 ] || return 1
	return 0
}

# The resolver CLI is the only producer of the ordered init set. This helper
# consumes its explicit LUA_INIT records; it never scans runtime directories,
# appends a package list, or infers order from file presence.
align_luaopt() {
	_lua_spec="$1"
	[ -f "$_lua_spec" ] || return 0
	resolver_luaopt "$_lua_spec" || return 1
	ZAPRET_BASE="$BASE"
	for INIT in "$BASE/init.d/openwrt/zapret2" /etc/init.d/zapret2; do
		[ -f "$INIT" ] || continue
		grep -q '^LUAOPT=' "$INIT" || continue
		_tmp_init="${INIT}.z2m-align"
		sed "s|^LUAOPT=.*|LUAOPT=\"$LUAOPT\"|" "$INIT" > "$_tmp_init"
		chmod 0644 "$_tmp_init"
		mv -f "$_tmp_init" "$INIT"
		if ! grep -q 'Z2K_STATE_DIR_OVERRIDE' "$INIT"; then
			sed -i '/^LUAOPT=/i export Z2K_STATE_DIR_OVERRIDE=\/etc\/zapret2-manager\/state\/autocircular' "$INIT"
		fi
	done
}

activation_rollback() {
	_records="$ACTIVATION_SNAPSHOT"
	_backup_dir="${ACTIVATION_SNAPSHOT}.files"
	if activation_restore "$_records" "$_backup_dir"; then
		printf '{"ok":true,"rolledBack":true}\n'
		return 0
	fi
	printf '{"ok":false,"rolledBack":false}\n'
	return 1
}

activation() {
	_spec="$1"
	[ -f "$_spec" ] || { printf '{"ok":false,"error":"activation spec is missing"}\n' >&2; return 1; }
	_tmp="$(mktemp -d /tmp/z2m-z2k-activate.XXXXXX 2>/dev/null)" || return 1
	_stage="$_tmp/stage"
	_backup_dir="${ACTIVATION_SNAPSHOT}.files"
	_records="${ACTIVATION_SNAPSHOT}.new"
	mkdir -p "$_stage" "$_backup_dir" || { rm -rf "$_tmp"; return 1; }
	: > "$_records"
	_index=0
	_lua_spec="$_tmp/lua-init"
	_overlay_spec="$_tmp/scanner-overlay"
	: > "$_lua_spec"
	: > "$_overlay_spec"
	while IFS='|' read -r _kind _id _type _entry_kind _source _target _sha _size _order; do
		case "$_kind" in ''|'#') continue ;; esac
		# Normalize the legacy seven-field direct spec before validation. It is
		# retained only as a compatibility seam; resolver output is eight fields.
		if [ "$_kind" = ASSET ] && [ -z "$_size" ] && printf '%s' "$_sha" | grep -Eq '^[0-9]+$'; then
			_size=$_sha; _sha=$_target; _target=$_source; _source=$_entry_kind; _entry_kind=$_type; _type=lifecycle-managed
		elif [ "$_kind" = REMOVE ] && [ -z "$_entry_kind" ] && [ -z "$_target" ] && [ -n "$_source" ]; then
			_target=$_source; _source=''; _entry_kind=$_type; _type=lifecycle-managed
		fi
		if [ "$_kind" = SNAPSHOT ]; then
			[ -n "$_id" ] && [ -n "$_type" ] && [ -n "$_entry_kind" ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			continue
		fi
		if [ "$_kind" = OVERLAY ]; then
			[ "${_scanner_mode:-0}" = 1 ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			printf 'OVERLAY|%s|%s|%s|%s|%s|%s|%s|%s\n' "$_id" "$_type" "$_entry_kind" "$_source" "$_target" "$_sha" "$_size" "$_order" >> "$_overlay_spec"
			continue
		fi
		if [ "$_kind" = LUA_INIT ]; then
			printf 'LUA_INIT|%s|%s|%s|%s|%s|%s|%s\n' "$_id" "$_type" "$_entry_kind" "$_source" "$_target" "$_sha" "$_size" >> "$_lua_spec"
			continue
		fi
		if [ "$_type" = lifecycle-managed ]; then
			case "$_target" in /runtime-assets/*) : ;; *) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
		elif [ "$_type" = package-static ]; then
			case "$_source" in "$PACKAGE_ROOT"/*) : ;; *) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
			case "$_target" in /opt/zapret2/*|/runtime-assets/*) : ;; *) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
		else
			rm -rf "$_tmp"; rm -f "$_records"; return 1
		fi
		runtime_target_rel "$_target" || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
		_dest="$BASE/$RUNTIME_TARGET_REL"
		if [ "$_kind" = ASSET ]; then
			case "$_type" in
				lifecycle-managed) case "$_source" in "$ASSET_ROOT"/*) : ;; *) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac ;;
				package-static) case "$_source" in "$PACKAGE_ROOT"/*) : ;; *) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac ;;
				*) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;;
			esac
			case "$_source" in *..*|*\\*) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
			case "$_sha" in ''|*[!A-Fa-f0-9]*) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
			[ "${#_sha}" -eq 64 ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			[ -f "$_source" ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			_actual="$(sha256sum "$_source" | awk '{print $1}')"
			_actual_size="$(wc -c < "$_source" | tr -d ' ')"
			[ "$_actual" = "$_sha" ] && [ "$_actual_size" = "$_size" ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			_stage_file="$_stage/$_index"
			mkdir -p "$(dirname "$_stage_file")" && cp "$_source" "$_stage_file" || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			printf '%s|%s|%s|%s\n' ASSET "$_dest" "$_stage_file" "$_index" >> "$_tmp/plan"
		else
			[ "$_kind" = REMOVE ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			[ "$_type" = lifecycle-managed ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			printf '%s|%s|%s|%s\n' REMOVE "$_dest" "$_dest" "$_index" >> "$_tmp/plan"
		fi
		_index=$((_index + 1))
	done < "$_spec"
	[ "$_index" -gt 0 ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }

	# Replace the previous runtime snapshot only after every source byte has
	# passed its SHA and size check.  This snapshot is also the rollback bridge
	# used when service postflight fails after materialization.
	rm -rf "$_backup_dir"
	mkdir -p "$_backup_dir" || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
	while IFS='|' read -r _op _dest _payload _n; do
		[ -n "$_dest" ] || continue
		case "$_dest" in "$BASE"/*) : ;; *) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
		if [ -f "$_dest" ]; then
			_backup="$_backup_dir/$_n"
			cp "$_dest" "$_backup" || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			printf '%s|%s|1\n' "$_dest" "$_backup" >> "$_records"
		else
			printf '%s||0\n' "$_dest" >> "$_records"
		fi
	done < "$_tmp/plan"

	# Publish each prepared file with rename semantics.  Fault injection is a
	# test-only hook; the EXIT trap restores the snapshot on any failed commit.
	committed=0
	trap 'rc=$?; if [ "$rc" -ne 0 ]; then activation_restore "${ACTIVATION_SNAPSHOT}.new" "${ACTIVATION_SNAPSHOT}.files" || true; fi; rm -rf "$_tmp"; rm -f "${ACTIVATION_SNAPSHOT}.new"; exit "$rc"' EXIT HUP INT TERM
	while IFS='|' read -r _op _dest _payload _n; do
		if [ "${Z2M_TEST_FAIL_AFTER:--1}" -ge 0 ] && [ "$_n" -ge "${Z2M_TEST_FAIL_AFTER:--1}" ]; then
			return 1
		fi
		if [ "$_op" = REMOVE ]; then
			rm -f "$_dest"
		else
			mkdir -p "$(dirname "$_dest")"
			_tmp_dest="$_dest.z2m-activate"
			cp "$_payload" "$_tmp_dest"
			chmod 0644 "$_tmp_dest"
			mv -f "$_tmp_dest" "$_dest"
		fi
		committed=$((_n + 1))
		done < "$_tmp/plan"
	if [ -s "$_lua_spec" ]; then
		for INIT in "$BASE/init.d/openwrt/zapret2" /etc/init.d/zapret2; do
			[ -f "$INIT" ] || continue
			grep -q '^LUAOPT=' "$INIT" || continue
			_init_backup="$_backup_dir/init-$committed"
			cp "$INIT" "$_init_backup" || return 1
			printf '%s|%s|1\n' "$INIT" "$_init_backup" >> "$_records"
			committed=$((committed + 1))
		done
		align_luaopt "$_lua_spec" || return 1
	fi
	if [ -s "$_overlay_spec" ]; then
		_lua_overlay_count=0
		while IFS='|' read -r _overlay_kind _id _type _entry_kind _source _target _sha _size _order; do
			[ "$_overlay_kind" = OVERLAY ] || continue
			[ "$_type" = scanner-overlay ] && [ "$_entry_kind" = lua ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			runtime_target_rel "$_target" || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			case "$_target" in /runtime-assets/lua/*) : ;; *) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
			_overlay_path="/opt/zapret2/$RUNTIME_TARGET_REL"
			[ -r "$_overlay_path" ] && [ ! -L "$_overlay_path" ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			case "$_sha" in ''|*[!A-Fa-f0-9]*) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
			[ "${#_sha}" -eq 64 ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			[ "$(sha256sum "$_overlay_path" | awk '{print $1}')" = "$_sha" ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			case "$_size" in ''|*[!0-9]*) rm -rf "$_tmp"; rm -f "$_records"; return 1 ;; esac
			[ "$(wc -c < "$_overlay_path" | tr -d ' ')" = "$_size" ] || { rm -rf "$_tmp"; rm -f "$_records"; return 1; }
			case "$_order" in ''|*[!0-9]*) : ;; esac
			set -- "$@" "--lua-init=@$_overlay_path"
			_lua_overlay_count=$((_lua_overlay_count + 1))
		done < "$_overlay_spec"
	fi
	mv -f "$_records" "$ACTIVATION_SNAPSHOT"
	trap - EXIT HUP INT TERM
	rm -rf "$_tmp"
	printf '{"ok":true,"activated":%s,"snapshot":"%s"}\n' "$committed" "$ACTIVATION_SNAPSHOT"
}

activate_resolved() {
	_consumer="$1"
	_input="$2"
	_tmp="$(mktemp -d /tmp/z2m-z2k-resolve.XXXXXX 2>/dev/null)" || return 1
	_spec="$_tmp/activation.tsv"
	_ucode=${Z2M_UCODE_BIN:-/usr/bin/ucode}
	_cli=${Z2M_RUNTIME_COMPOSITION_CLI:-/usr/libexec/zapret2-manager/runtime-composition-cli.uc}
	"$_ucode" "$_cli" "$_consumer" "$_input" activation-tsv > "$_spec" || { rm -rf "$_tmp"; return 1; }
	[ -s "$_spec" ] || { rm -rf "$_tmp"; return 1; }
	_scanner_mode=0
	[ "$_consumer" = scanner ] && _scanner_mode=1
	activation "$_spec" "$_scanner_mode"
	_rc=$?
	rm -rf "$_tmp"
	return "$_rc"
}

case "${1:-}" in
	--activate-registry)
		activation "${2:-}"
		exit $?
		;;
	--activate-resolved)
		activate_resolved "${2:-}" "${3:-}"
		exit $?
		;;
	--rollback-registry)
		activation_rollback
		exit $?
		;;
esac

[ -d "$SRC" ] || { printf '{"ok":false,"missing":["SRC:%s"],"mismatched":[],"count":0}\n' "$SRC"; exit 1; }
# The runtime base itself is owned by the engine payload/installer; only its
# direct children are created here (no recursive traversal), and re-running
# over an existing tree is a no-op per directory.
ensure_dir() { [ -d "$1" ] || mkdir "$1"; }
ensure_dir "$BASE/files"
ensure_dir "$BASE/files/fake"
ensure_dir "$BASE/lua"
ensure_dir "$BASE/lists"
ensure_dir "$BASE/ipset"
# nfqws2 drops privileges to nobody before reading Lua/blobs: keep the
# runtime asset directories world-traversable regardless of caller umask.
chmod 0755 "$BASE" "$BASE/files" "$BASE/files/fake" "$BASE/lua" "$BASE/lists" "$BASE/ipset" 2>/dev/null || true
[ -e "$BASE/bin" ] || ln -s "$BASE/files/fake" "$BASE/bin"
ensure_dir "$ETC_ROOT/lists"
[ -f "$ETC_ROOT/lists/whitelist.txt" ] || touch "$ETC_ROOT/lists/whitelist.txt"

# The nfqws2 daemon persists circular host bindings while rpcd reads them from
# the canonical Z2M state path. z2m-root-bootstrap policy requires
# /etc/zapret2-manager/state to stay root:root (it refuses gid!=0 at boot),
# so only the narrow autocircular leaf is handed to the daemon group.
ensure_dir "$STATE_ROOT"
if [ "$(id -u)" = "0" ]; then
	chown root:root "$STATE_ROOT" 2>/dev/null || true
	# z2m-root-bootstrap policy: final persistent roots must be exactly 0700.
	chmod 0700 "$STATE_ROOT"
fi
ensure_dir "$STATE_DIR"
if [ "$(id -u)" = "0" ]; then
	chown root:daemon "$STATE_DIR" 2>/dev/null || true
	chmod 0770 "$STATE_DIR"
fi
if [ ! -e "$STATE_DIR/state.tsv" ]; then
	: > "$STATE_DIR/state.tsv"
fi
if [ "$(id -u)" = "0" ]; then
	chown root:daemon "$STATE_DIR/state.tsv" 2>/dev/null || true
	chmod 0660 "$STATE_DIR/state.tsv"
fi

PREFLIGHT_MANIFEST=${Z2M_PREFLIGHT_MANIFEST:-/usr/share/zapret2-manager/native-preflight.json}
is_core_lua() {
	[ -f "$PREFLIGHT_MANIFEST" ] || return 1
	grep -Fq "/lua/$1\"" "$PREFLIGHT_MANIFEST"
}

# Z2K lifecycle Lua uses a reserved namespace in the package.  This is only a
# local precedence guard; Registry -> runtime path mapping remains in the
# canonical UCode bridge below the Engine worker.
is_z2k_lifecycle_lua() {
	case "$1" in
		z2k-*.lua) return 0 ;;
		*) return 1 ;;
	esac
}

# A successful Registry activation records every selected target in this
# rollback snapshot.  Reusing that evidence keeps already-selected runtime
# bytes safe for package sync without duplicating the Registry classification.
is_registry_selected_target() {
	[ -f "$ACTIVATION_SNAPSHOT" ] || return 1
	while IFS='|' read -r _dest _backup _had; do
		[ "$_dest" = "$1" ] && return 0
	done < "$ACTIVATION_SNAPSHOT"
	return 1
}

preserve_existing_runtime() {
	_dst="$1"
	_name="${_dst##*/}"
	case "$_dst" in
		*/lua/*)
			is_core_lua "$_name" || is_z2k_lifecycle_lua "$_name" || is_registry_selected_target "$_dst"
			;;
		*)
			is_registry_selected_target "$_dst"
			;;
	esac
}

copy_if_missing_or_custom() {
	_src="$1"
	_dst="$2"
	# Engine core and selected Z2K bytes are protected. Manager-owned package
	# sidecars are refreshable and therefore receive the new package byte.
	if [ -e "$_dst" ] && preserve_existing_runtime "$_dst"; then
		return 0
	fi
	cp "$_src" "$_dst"
	if [ "${_dst##*.}" = "lua" ]; then chmod 0755 "$_dst";
	elif [ "${_dst##*.}" = "sh" ]; then chmod 0755 "$_dst"; # scripts stay executable (create_ipset.sh is invoked by the zapret2 init)
	else chmod 0644 "$_dst"; fi
}

materialize() {
	for _src in "$SRC"/bin/*; do
		[ -f "$_src" ] || continue
		copy_if_missing_or_custom "$_src" "$BASE/files/fake/${_src##*/}"
	done
	for _src in "$SRC"/lua/*; do
		[ -f "$_src" ] || continue
		copy_if_missing_or_custom "$_src" "$BASE/lua/${_src##*/}"
	done
	for _src in "$SRC"/lists/*; do
		[ -f "$_src" ] || continue
		# The catalog carries the option kind; keeping the bundled file in both
		# trusted roots makes a missing kind mapping impossible at Apply time.
		copy_if_missing_or_custom "$_src" "$BASE/lists/${_src##*/}"
		copy_if_missing_or_custom "$_src" "$BASE/ipset/${_src##*/}"
	done
}

verify() {
	files=''
	first=1
	missing=''
	mismatched=''
	count=0
	add_verdict() {
		_rel="$1"; _installed="$2"
		if [ ! -f "$_installed" ]; then
			missing="$missing${missing:+, }\"$_rel\""
		elif [ "$(sha256sum "$_installed" | awk '{print $1}')" != "$(sha256sum "$1" | awk '{print $1}')" ]; then
			mismatched="$mismatched${mismatched:+, }\"$_rel\""
		else
			files="$files${files:+, }{\"path\":\"$_rel\",\"sha256\":\"$(sha256sum "$_installed" | awk '{print $1}')\"}"
			count=$((count + 1))
		fi
	}
	for _src in "$SRC"/bin/*; do
		[ -f "$_src" ] || continue
		add_verdict "$_src" "$BASE/files/fake/${_src##*/}"
	done
	for _src in "$SRC"/lua/*; do
		[ -f "$_src" ] || continue
		# Core upstream Lua files are engine-owned after a compatible install
		# (their integrity is proven by the engine payload digest + capability
		# proof, not by the manager baseline).
		if [ -f "$BASE/lua/${_src##*/}" ] && { is_core_lua "${_src##*/}" || { is_z2k_lifecycle_lua "${_src##*/}" && is_registry_selected_target "$BASE/lua/${_src##*/}"; }; }; then
			continue
		fi
		add_verdict "$_src" "$BASE/lua/${_src##*/}"
	done
	# Lists are user-owned after install (restored from backup and never
	# overwritten): their content is a user-data concern, not a manager
	# baseline integrity concern.
	for _src in "$SRC"/lists/*; do
		[ -f "$_src" ] || continue
		if [ ! -f "$BASE/lists/${_src##*/}" ]; then
			copy_if_missing_or_custom "$_src" "$BASE/lists/${_src##*/}"
			copy_if_missing_or_custom "$_src" "$BASE/ipset/${_src##*/}"
		fi
	done
	ok=1
	[ -z "$missing" ] || ok=0
	[ -z "$mismatched" ] || ok=0
	# A zero-file verdict means the package baseline was absent: Z2K cannot
	# be materialized from nothing. Fail closed.
	[ "$count" -ge 1 ] || ok=0
	ok_json=false
	[ "$ok" = 1 ] && ok_json=true
	printf '{"ok":%s,"files":[%s],"missing":[%s],"mismatched":[%s],"count":%s}\n' \
		"$ok_json" "$files" "$missing" "$mismatched" "$count"
	[ "$ok" = 1 ]
}

case "${1:-}" in
--verify)
	verify
	;;
'')
	materialize
	# LuaOPT is changed only by a resolver-backed activation. Package baseline
	# synchronization has no lifecycle snapshot and must not infer a load set.
	exit 0
	;;
*)
	printf 'usage: %s [--verify|--activate-resolved consumer input]\n' "$0" >&2
	exit 2
	;;
esac
