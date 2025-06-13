import json
import re

def save_failed_tests_details(json_file_path, output_file_path):
    try:
        with open(json_file_path, 'r') as f:
            results = json.load(f)
    except FileNotFoundError:
        with open(output_file_path, 'w') as out_f:
            out_f.write(f"Error: Test results file not found at {json_file_path}\n")
        return
    except json.JSONDecodeError:
        with open(output_file_path, 'w') as out_f:
            out_f.write(f"Error: Could not decode JSON from {json_file_path}\n")
        return

    failed_count = 0
    output_lines = []

    if not results.get('testResults'):
        output_lines.append("No testResults found in JSON.\n")
        with open(output_file_path, 'w') as out_f:
            out_f.writelines(output_lines)
        return

    for test_suite in results['testResults']:
        suite_path = test_suite.get('name', 'Unknown Suite Path')
        suite_has_failures = False
        suite_output_lines = []

        for assertion_result in test_suite.get('assertionResults', []):
            if assertion_result.get('status') == 'failed':
                if not suite_has_failures: # Add suite header only once and if there are failures
                    suite_output_lines.append(f"\n--- Test Suite FAILED: {suite_path} ---\n")
                    suite_has_failures = True

                failed_count += 1
                suite_output_lines.append(f"  Test: {assertion_result.get('title', 'Unknown Test')}\n")
                suite_output_lines.append(f"    Status: {assertion_result.get('status')}\n")

                failure_messages = assertion_result.get('failureMessages', [])
                if not failure_messages:
                    suite_output_lines.append(f"    Error Message: No specific error message provided in JSON.\n")
                else:
                    for i, msg in enumerate(failure_messages):
                        # Remove ANSI escape codes for cleaner output
                        ansi_escape = re.compile(r'\x1B(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])')
                        # Also remove escape sequences like \n, \" by first decoding them
                        # Python's json.loads already handles standard JSON string escapes (\n, \", etc.)
                        # The backslashreplace and unicode-escape was more for complex/raw byte escapes
                        # which shouldn't be standard in Vitest JSON output.
                        # Keep it simple unless specific encoding issues are observed from Vitest.
                        clean_msg = ansi_escape.sub('', msg)
                        clean_msg = clean_msg.replace('\n', '\n        ') # Indent multi-line messages
                        suite_output_lines.append(f"    Error Message {i+1}: {clean_msg}\n")

                location = assertion_result.get('location') # Vitest doesn't provide this in assertionResults
                                                            # It's usually part of the stack trace in failureMessages
                # if location:
                #     suite_output_lines.append(f"    Location: Line {location.get('line', 'N/A')}, Column {location.get('column', 'N/A')}\n")
                suite_output_lines.append("    ---\n")

        if suite_has_failures:
            output_lines.extend(suite_output_lines)

    total_failed_from_summary = results.get('numFailedTests', 'N/A')
    output_lines.append(f"\nTotal failed tests reported by Vitest: {total_failed_from_summary}\n")
    output_lines.append(f"Total failed assertions parsed from details: {failed_count}\n")

    with open(output_file_path, 'w') as out_f:
        out_f.writelines(output_lines)
    print(f"Failed test details saved to {output_file_path}")

# Assuming 'test-results-after-toexponential_fix.json' is the latest correct one from previous step
# or 'test-results.json' if that was the last full run before individual fixes.
# The prompt implies using the result from the "fixes" attempt, which was test-results-after-toexponential_fix.json
save_failed_tests_details('test-results-after-toexponential_fix.json', 'failed_tests_details.txt')
print("Attempted to save detailed failed test information to failed_tests_details.txt")
