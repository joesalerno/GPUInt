# LLM-Optimized GPU Speed Improvement Action Checklist

This checklist is designed for step-by-step, context-light, atomic improvements. For each item:
- Run `npm test -- --run` to benchmark current performance and save results.
- Implement the checklist item below.
- Test and stabilize the improvement before moving to the next item.
- Document results and mark the item as complete.

---

## 1. Baseline & Setup
- [ ] Run `npm test -- --run` and save output to `benchmarks/baseline.txt`.
- [ ] List all GPU kernel entry points in `docs/gpu_entry_points.md`.
- [ ] List all CPU-GPU data transfer points in `docs/data_transfers.md`.

## 2. Profiling
- [ ] Profile all GPU kernels using a profiler; save timing results to `profiling/kernel_timings.txt`.
- [ ] Profile all memory transfers; save results to `profiling/mem_transfers.txt`.
- [ ] Identify top 3 slowest kernels and document in `profiling/top_kernels.md`.

## 3. Algorithmic Improvements
- [ ] For the slowest kernel, research and propose a faster algorithm in `algorithms/alternatives.md`.
- [ ] Implement the proposed algorithm for the slowest kernel.
- [ ] Test and benchmark the new algorithm; document results in `algorithms/alternatives.md`.
- [ ] Repeat for the next slowest kernel.
- [ ] Identify and batch similar GPU operations; document in `algorithms/batching.md`.
- [ ] Implement batching for one operation; test and document results.
- [ ] Repeat batching for other operations.

## 4. Memory Optimization
- [ ] For each kernel, analyze memory access patterns; document in `memory/access_patterns.md`.
- [ ] Suggest and implement coalesced memory access for one kernel.
- [ ] Test and document performance change.
- [ ] Repeat for other kernels.
- [ ] List all dynamic allocations in GPU code in `memory/allocations.md`.
- [ ] Reduce allocations in one kernel; test and document.
- [ ] Repeat for other kernels.

## 5. Kernel/Shader Optimization
- [ ] For each kernel, list all branches in `kernels/branching.md`.
- [ ] Refactor one kernel to minimize branching; test and document.
- [ ] Repeat for other kernels.
- [ ] Document current thread/block sizes in `kernels/thread_block_sizes.md`.
- [ ] Tune thread/block sizes for one kernel; test and document.
- [ ] Repeat for other kernels.

## 6. Resource Utilization
- [ ] Record GPU occupancy and memory bandwidth stats in `utilization/occupancy.md`.
- [ ] Suggest workload distribution improvements in `utilization/workload_balance.md`.
- [ ] Implement one workload balance improvement; test and document.
- [ ] Repeat for other improvements.

## 7. Testing & Validation
- [ ] After each change, run `npm test -- --run` and save output to `benchmarks/` with a descriptive filename.
- [ ] Compare new results to baseline and previous runs.
- [ ] If regression is detected, revert and debug before continuing.

## 8. Documentation & Review
- [ ] For every completed item, add a summary to `docs/optimization_log.md`.
- [ ] Request peer review for each major change and log feedback in `docs/review_log.md`.

---

**Instructions:**
- Only work on one checklist item at a time.
- Always benchmark and test before and after each change.
- Document every step in the specified file.
- Mark the item as complete before moving on.

This structure ensures atomic, context-light, and easily pick-up-able tasks for LLMs or developers.
