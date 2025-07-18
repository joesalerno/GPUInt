# LLM-Optimized GPU Calculation Speed Improvement Checklist

This checklist is structured for efficient LLM processing: tasks are atomic, context is minimized, and each item is self-contained. Use this to enable LLMs (or developers) to pick up, execute, and complete tasks with minimal prior context.

---

## 1. Baseline & Benchmarking
- [ ] **Record Current Performance**: Log execution time and memory usage for all GPU calculation entry points. Save results in `benchmarks/`.
- [ ] **Identify Bottlenecks**: Profile GPU code and list slowest functions/kernels in `bottlenecks.md`.

## 2. Profiling & Analysis
- [ ] **Profile Kernel Execution**: Use a GPU profiler to capture kernel timings. Save output as `profiling/kernel_timings.txt`.
- [ ] **Analyze Memory Transfers**: List all CPU-GPU memory transfers and their sizes in `profiling/mem_transfers.md`.

## 3. Algorithmic Improvements
- [ ] **Suggest Faster Algorithms**: For each bottleneck, propose at least one alternative algorithm in `algorithms/alternatives.md`.
- [ ] **Batch Operations**: Identify and list opportunities to batch similar GPU operations in `algorithms/batching.md`.

## 4. Memory Optimization
- [ ] **Optimize Access Patterns**: For each kernel, describe memory access patterns and suggest improvements in `memory/access_patterns.md`.
- [ ] **Reduce Allocations**: List all dynamic allocations in GPU code and suggest reductions in `memory/allocations.md`.

## 5. Kernel/Shader Optimization
- [ ] **Minimize Branching**: For each kernel, list all branches and suggest ways to reduce divergence in `kernels/branching.md`.
- [ ] **Tune Thread/Block Sizes**: Document current thread/block sizes and propose optimizations in `kernels/thread_block_sizes.md`.

## 6. Resource Utilization
- [ ] **Monitor Utilization**: Record GPU occupancy and memory bandwidth stats in `utilization/occupancy.md`.
- [ ] **Balance Workloads**: Suggest workload distribution improvements in `utilization/workload_balance.md`.

## 7. Testing & Validation
- [ ] **Test After Each Change**: For every optimization, run the test suite and log results in `tests/optimization_results.md`.
- [ ] **Benchmark After Each Change**: Update `benchmarks/` with new performance data after each optimization.

## 8. Documentation & Review
- [ ] **Document Each Change**: For every completed task, add a summary to `docs/optimization_log.md`.
- [ ] **Peer Review**: Request review for each major change and log feedback in `docs/review_log.md`.

---

**Instructions for LLMs/Developers:**
- Each checklist item is atomic and can be completed independently.
- Use the specified file for all notes, results, and suggestions.
- Avoid referencing external context; keep all relevant info in the designated file.
- After completing a task, mark it as done and summarize the result in the file.

This structure ensures minimal context rot and maximizes the ability for LLMs or developers to contribute efficiently in short, focused sessions.
