/* URL-path readFileSync is a separate unit so unused diagnostics and
 * encoding checks add nothing to programs that read string paths. */
#include "scr_runtime.h"
#include <stdio.h>
#include <string.h>

static bool scr_fs_url_str_is(const ScrStr *value, const char *text) {
  size_t length = strlen(text);
  return value->len == length && memcmp(value->data, text, length) == 0;
}

static bool scr_fs_url_encoding_valid(ScrStr *encoding) {
  if (encoding->len == 0 || scr_bytes_is_encoding(encoding)) return true;
  ScrDyn *value = scr_dyn_new_str(encoding);
  scr_dyn_arg_value_fail("encoding", "is invalid encoding", value);
  scr_dyn_release(value);
  return false;
}

/* These documented fields change Node's filesystem behavior. Detect their
 * presence without calling a getter, including inherited/nonenumerable fields,
 * and refuse before opening the file instead of silently dropping them. */
static bool scr_fs_url_options_supported(const ScrDyn *options) {
  static const char *const unsupported[] = { "flag", "buffer", "signal" };
  for (size_t i = 0; i < sizeof unsupported / sizeof unsupported[0]; i++) {
    ScrStr *key = scr_str_new(unsupported[i], strlen(unsupported[i]));
    bool present = scr_dyn_has_key(options, key);
    scr_str_release(key);
    if (scr_exc_pending()) return false;
    if (present) {
      char message[128];
      int length = snprintf(message, sizeof message,
        "readFileSync URL option '%s' has no native lowering", unsupported[i]);
      scr_throw_error_msg_code(SCR_ERR_ERROR, message, (size_t)length, "SC2020");
      return false;
    }
  }
  return true;
}

/* Keep each encoding property read: accessors can change the encoding or the
 * URL between getOptions validation, fast-path selection, and decoding. */
static ScrDyn *scr_fs_url_encoding(const ScrDyn *options, bool object) {
  if (object) {
    ScrDyn *view = options->kind == SCR_DYN_TYPED_REF
      ? scr_dyn_typed_ref_materialize(options) : scr_dyn_retain((ScrDyn *)options);
    ScrDyn *value = view ? scr_dyn_obj_read(view, "encoding", 8) : NULL;
    scr_dyn_release(view);
    return value;
  }
  return scr_dyn_retain((ScrDyn *)(options->kind == SCR_DYN_STR ? options : scr_dyn_undefined()));
}

/* readFileSync validates encoding before converting a URL path. Its operands
 * have already evaluated, so changes to the URL during options evaluation
 * and encoding getters remain visible to the conversion. */
ScrDyn *scr_fs_read_file_url(ScrUrl *url, const ScrDyn *options) {
  bool object = options->kind != SCR_DYN_NULL && scr_dyn_is_object(options);
  if (!object && options->kind != SCR_DYN_STR && options->kind != SCR_DYN_UNDEF &&
      options->kind != SCR_DYN_NULL && !scr_dyn_is_callable(options)) {
    scr_dyn_arg_type_fail("options", "of type string or an instance of Object", options);
    return NULL;
  }
  if (object && !scr_fs_url_options_supported(options)) return NULL;
  ScrDyn *encoding = scr_fs_url_encoding(options, object);
  ScrDyn *result = NULL;
  ScrStr *path = NULL;
  ScrBytes *bytes = NULL;
  if (scr_exc_pending()) goto done;
  if (encoding->kind != SCR_DYN_STR || !scr_fs_url_str_is(encoding->v.str, "buffer")) {
    scr_dyn_release(encoding);
    encoding = scr_fs_url_encoding(options, object);
    if (scr_exc_pending()) goto done;
    if (scr_dyn_truthy(encoding)) {
      if (encoding->kind != SCR_DYN_STR) {
        scr_dyn_arg_value_fail("encoding", "is invalid encoding", encoding);
        goto done;
      }
      if (!scr_fs_url_encoding_valid(encoding->v.str)) goto done;
    }
  }
  scr_dyn_release(encoding);
  encoding = scr_fs_url_encoding(options, object);
  if (scr_exc_pending()) goto done;
  bool utf8 = encoding->kind == SCR_DYN_STR && scr_fs_url_str_is(encoding->v.str, "utf8");
  if (!utf8) {
    scr_dyn_release(encoding);
    encoding = scr_fs_url_encoding(options, object);
    if (scr_exc_pending()) goto done;
    utf8 = encoding->kind == SCR_DYN_STR && scr_fs_url_str_is(encoding->v.str, "utf-8");
  }
  // Encoding getters may have introduced a behavior-changing option.
  if (object && !scr_fs_url_options_supported(options)) goto done;
  path = scr_url_to_path(url);
  if (!path) goto done;
  if (utf8) {
    ScrStr *text = scr_fs_read_file(path);
    if (text) { result = scr_dyn_new_str(text); scr_str_release(text); }
    goto done;
  }
  bytes = scr_fs_read_file_bytes(path);
  if (!bytes) goto done;
  scr_dyn_release(encoding);
  encoding = scr_fs_url_encoding(options, object);
  if (scr_exc_pending()) goto done;
  if (!scr_dyn_truthy(encoding)) result = scr_dyn_new_buffer(bytes);
  else {
    scr_dyn_release(encoding);
    encoding = scr_fs_url_encoding(options, object);
    if (scr_exc_pending()) goto done;
    ScrStr *name = encoding->kind == SCR_DYN_UNDEF
      ? scr_str_new("utf8", 4) : scr_dyn_string_coerce_js(encoding);
    if (!name) goto done;
    ScrStr *text = scr_bytes_to_str_checked(bytes, name);
    scr_str_release(name);
    if (text) { result = scr_dyn_new_str(text); scr_str_release(text); }
  }
done:
  scr_dyn_release(encoding);
  scr_str_release(path);
  scr_bytes_release(bytes);
  return result;
}
