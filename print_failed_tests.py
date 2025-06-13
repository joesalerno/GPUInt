import json

def print_failed_tests(json_file_path):
    try:
        with open(json_file_path, 'r') as f:
            results = json.load(f)
    except FileNotFoundError:
        print(f"Error: Test results file not found at {json_file_path}")
        return
    except json.JSONDecodeError:
        print(f"Error: Could not decode JSON from {json_file_path}")
        return

    failed_count = 0
    if not results.get('testResults'):
        print("No testResults found in JSON.")
        return

    for test_suite in results['testResults']:
        suite_path = test_suite.get('name', 'Unknown Suite Path')
        if test_suite.get('status') == 'failed' or any(a.get('status') == 'failed' for a in test_suite.get('assertionResults', [])):
            print(f"\n--- Test Suite FAILED: {suite_path} ---")
            for assertion_result in test_suite.get('assertionResults', []):
                if assertion_result.get('status') == 'failed':
                    failed_count += 1
                    print(f"  Test: {assertion_result.get('title', 'Unknown Test')}")
                    print(f"    Status: {assertion_result.get('status')}")
                    for i, msg in enumerate(assertion_result.get('failureMessages', [])):
                        # Remove ANSI escape codes for cleaner output
                        import re
                        ansi_escape = re.compile(r'\x1B(?:[@-Z\-_]|[[0-?]*[ -/]*[@-~])')
                        clean_msg = ansi_escape.sub('', msg)
                        print(f"    Error Message {i+1}: {clean_msg}")
                    print(f"    Location: {assertion_result.get('location')}") # Might be null
                    print("    ---")

    total_failed_from_summary = results.get('numFailedTests', 'N/A')
    print(f"\nTotal failed tests reported by Vitest: {total_failed_from_summary}")
    print(f"Total failed assertions parsed from details: {failed_count}")

print_failed_tests('test-results.json')
