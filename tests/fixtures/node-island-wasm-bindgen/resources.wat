;; Test-only Rust ownership stand-in: each nonzero pointer owns one slot.
;; An invalid or duplicate release traps instead of hiding a double free.
(module
  (memory (export "memory") 1)
  (global $next (mut i32) (i32.const 4))
  (global $allocated (export "allocated") (mut i32) (i32.const 0))
  (global $released (export "released") (mut i32) (i32.const 0))
  (global $finalized (export "finalized") (mut i32) (i32.const 0))
  (func (export "allocate") (result i32) (local $ptr i32)
    global.get $next local.tee $ptr i32.const 1 i32.store
    global.get $next i32.const 4 i32.add global.set $next
    global.get $allocated i32.const 1 i32.add global.set $allocated
    local.get $ptr)
  (func (export "release") (param $ptr i32) (param $gc i32)
    local.get $ptr i32.eqz if unreachable end
    local.get $ptr i32.load i32.eqz if unreachable end
    local.get $ptr i32.const 0 i32.store
    global.get $released i32.const 1 i32.add global.set $released
    local.get $gc if
      global.get $finalized i32.const 1 i32.add global.set $finalized
    end))
