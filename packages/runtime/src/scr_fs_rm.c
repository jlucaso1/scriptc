/* Option-aware fs.promises.rm wrappers, linked only for these overloads. */
#include "scr_runtime.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdio.h>

ScrPromise *scr_fsp_rm_opts(ScrStr *path, bool recursive, bool force) {
  return scr_fsp_rm_opts_retry(path, recursive, force, 0, 100);
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

/* These calls only inspect filesystem errors raised by the operations below.
 * Keep their payload intact when the error is not retried. */
static bool scr_fsp_rm_error_is(const char *code) {
  ScrExcCell *cell = scr_exc_current_cell();
  if (cell->kind != SCR_EXC_OBJ || cell->release_fn != scr_error_release_v) return false;
  ScrError *error = cell->payload;
  return error->code && strcmp(error->code->data, code) == 0;
}

static void scr_fsp_rm_child(ScrStr *path, uint64_t max_retries, double retry_delay);

static void scr_fsp_rm_attempt(ScrStr *path, uint64_t max_retries, double retry_delay) {
  ScrStats *stats = scr_fs_lstat(path);
  if (scr_exc_pending()) return;
  bool directory = scr_stats_is_dir(stats) && !scr_stats_is_symlink(stats);
  scr_stats_release(stats);
  if (!directory) {
    /* Reuse the platform-specific link and read-only-file handling, but
     * retry this entry here instead of restarting the complete tree. */
    scr_fs_rm_opts(path, false, true);
    return;
  }
  scr_fs_rmdir(path);
  if (!scr_exc_pending()) return;
  if (!(scr_fsp_rm_error_is("ENOTEMPTY") || scr_fsp_rm_error_is("EEXIST")
#ifndef _WIN32
        || scr_fsp_rm_error_is("EPERM")
#endif
      )) return;
  scr_exc_clear();
  ScrArr *names = scr_fs_readdir(path);
  if (scr_exc_pending()) return;
  size_t count = (size_t)scr_arr_len(names);
  for (size_t i = 0; i < count; i++) {
    ScrStr *name = scr_arr_get_ref(names, (double)i);
    size_t length = path->len + 1 + name->len;
    char *bytes = malloc(length + 1);
    if (!bytes) scr_trap("scriptc: out of memory\n");
    memcpy(bytes, path->data, path->len);
    bytes[path->len] = '/';
    memcpy(bytes + path->len + 1, name->data, name->len);
    bytes[length] = 0;
    ScrStr *child = scr_str_new(bytes, length);
    free(bytes);
    scr_str_release(name);
    scr_fsp_rm_child(child, max_retries, retry_delay);
    scr_str_release(child);
    if (scr_exc_pending()) break;
  }
  scr_arr_release(names);
  if (!scr_exc_pending()) scr_fs_rmdir(path);
}

/* Node's rimraf creates a budget for every recursive invocation. A child
 * exhausting its budget can still cause its parent to retry its own walk. */
static void scr_fsp_rm_child(ScrStr *path, uint64_t max_retries, double retry_delay) {
  for (uint64_t attempt = 0;; attempt++) {
    scr_fsp_rm_attempt(path, max_retries, retry_delay);
    if (!scr_exc_pending()) return;
    if (scr_fsp_rm_error_is("ENOENT")) {
      scr_exc_clear();
      return;
    }
    bool retryable = scr_fsp_rm_error_is("EBUSY") || scr_fsp_rm_error_is("EMFILE") ||
      scr_fsp_rm_error_is("ENFILE") || scr_fsp_rm_error_is("ENOTEMPTY") ||
      scr_fsp_rm_error_is("EPERM");
    if (!retryable || attempt >= max_retries) return;
    scr_exc_clear();
    double ms = retry_delay * (double)(attempt + 1);
    if (ms > 0) {
      struct timespec duration;
      duration.tv_sec = (time_t)(ms / 1000.0);
      duration.tv_nsec = (long)((ms - (double)duration.tv_sec * 1000.0) * 1000000.0);
      nanosleep(&duration, NULL);
    }
  }
}

ScrPromise *scr_fsp_rm_opts_retry(ScrStr *path, bool recursive, bool force, double max_retries, double retry_delay) {
  if (scr_fs_path_ok(path, "path") &&
      scr_fsp_rm_integer_valid(max_retries, "options.maxRetries", 4294967295.0) &&
      scr_fsp_rm_integer_valid(retry_delay, "options.retryDelay", 2147483647.0)) {
    if (!recursive) {
      /* Keep initial missing-path validation distinct from an entry that
       * disappears after validation, which promise rimraf treats as success. */
      ScrStats *stats = scr_fs_lstat(path);
      scr_stats_release(stats);
      if (force && scr_fsp_rm_error_is("ENOENT")) scr_exc_clear();
      else if (!scr_exc_pending()) {
        scr_fs_rm_opts_retry(path, false, force, max_retries, retry_delay);
        if (scr_fsp_rm_error_is("ENOENT")) scr_exc_clear();
      }
    } else {
      /* Node validates root existence before rimraf; disappearing children
       * and entries that vanish during removal are then harmless ENOENTs. */
      ScrStats *stats = scr_fs_lstat(path);
      scr_stats_release(stats);
      if (force && scr_fsp_rm_error_is("ENOENT")) scr_exc_clear();
      if (!scr_exc_pending()) scr_fsp_rm_child(path, (uint64_t)max_retries, retry_delay);
    }
  }
  return scr_promise_settled_void();
}
