/* Option-aware fs.promises.rm wrappers, linked only for these overloads. */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>

ScrPromise *scr_fsp_rm_opts(ScrStr *path, bool recursive, bool force) {
  scr_fs_rm_opts(path, recursive, force);
  return scr_promise_settled_void();
}

static bool scr_fsp_rm_integer_valid(double value, const char *name, double maximum) {
  bool integer = isfinite(value) && trunc(value) == value;
  if (integer && value >= 0 && value <= maximum) return true;
  char received[48], bound[64], message[224];
  scr_num_received(value, received);
  if (integer) snprintf(bound, sizeof bound, ">= 0 && <= %.0f", maximum);
  else snprintf(bound, sizeof bound, "an integer");
  int length = snprintf(message, sizeof message,
    "The value of \"%s\" is out of range. It must be %s. Received %s", name, bound, received);
  scr_throw_error_msg_code(SCR_ERR_RANGE, message, (size_t)length, "ERR_OUT_OF_RANGE");
  return false;
}

ScrPromise *scr_fsp_rm_opts_retry(ScrStr *path, bool recursive, bool force, double max_retries, double retry_delay) {
  if (scr_fs_path_ok(path, "path") &&
      scr_fsp_rm_integer_valid(max_retries, "options.maxRetries", 4294967295.0) &&
      scr_fsp_rm_integer_valid(retry_delay, "options.retryDelay", 2147483647.0)) {
    scr_fs_rm_opts_retry(path, recursive, force, max_retries, retry_delay);
  }
  return scr_promise_settled_void();
}
