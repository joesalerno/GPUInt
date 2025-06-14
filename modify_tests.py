import re

with open('lib/bigint.test.js', 'r') as f:
    content = f.read()

# Pattern to find the large commented out section
# It starts with /* // Comment out ALL other describe blocks
# and ends with */ just before the 'Precision Methods' describe block.
# Adjusted pattern to be more specific about the end of the comment block
comment_block_pattern = re.compile(
    r"(/\* // Comment out ALL other describe blocks\s*)"  # Group 1: The starting comment line
    r"(.*)"                                               # Group 2: The content of all commented describes (non-greedy)
    r"(\s*\*/\s*describe\('Precision Methods)",           # Group 3: The ending sequence
    re.DOTALL
)

match = comment_block_pattern.search(content)
if match:
    leading_comment_line = match.group(1)
    all_commented_describes_content = match.group(2)
    # The trailing_code_after_comment needs to be the part that closes the comment AND the Precision Methods describe
    # The original regex for group 3 was correct to identify the end boundary.
    # Let's call what was matched as group 3 as the "end_marker_sequence"
    end_marker_sequence = match.group(3)


    # Find the 'constructor' block within all_commented_describes_content
    # Regex needs to be robust enough for potential variations in spacing or newlines.
    # It should capture the entire 'constructor' block.
    # This pattern assumes that `});` correctly closes the constructor block
    # and is followed by a newline or space before the next `describe`.
    constructor_block_pattern = re.compile(
        r"(\s*describe\('constructor',\s*\(\)\s*=>\s*\{.*?\s*\}\);)",
        re.DOTALL
    )
    constructor_match = constructor_block_pattern.search(all_commented_describes_content)

    if constructor_match:
        constructor_code_with_leading_space = constructor_match.group(1)
        constructor_code = constructor_code_with_leading_space.lstrip() # Remove leading spaces for clean insertion

        # Remove constructor code from the all_commented_describes_content
        # Need to be careful to remove the exact matched part including its original leading whitespace
        # to avoid altering spacing of subsequent blocks.
        # Using string replacement on all_commented_describes_content
        temp_remaining_describes = all_commented_describes_content.replace(constructor_code_with_leading_space, "", 1)

        # Reconstruct the new file content
        # The original block started with `/* // Comment out ...`
        # We want to change this to `// // Comment out ...`
        # Then print the constructor_code
        # Then start a new comment `/*` for the remaining_describes
        # Then print remaining_describes
        # Then close with the original end_marker_sequence `*/ describe('Precision Methods'...`

        # Group 1 was `/\* // Comment out ALL other describe blocks\s*`
        # Change it to `// // Comment out ALL other describe blocks\n`
        new_leading_comment_line = "//" + leading_comment_line[1:] # Changes /* to //*

        new_content = content.replace(
            leading_comment_line + all_commented_describes_content + end_marker_sequence,
            f"{new_leading_comment_line.rstrip()}" # Make sure no extra newlines from rstrip
            f"\n{constructor_code}"  # constructor_code already has its necessary leading whitespace from the match
            f"\n/*" # Start new comment for remaining
            f"{temp_remaining_describes}" # remaining_describes includes its original leading whitespace
            f"{end_marker_sequence}" # This includes the */ and the Precision Methods describe
        )

        with open('lib/bigint.test.js', 'w') as f:
            f.write(new_content)
        print("Successfully uncommented 'constructor' test suite and re-commented others.")
    else:
        print("Could not find the 'constructor' describe block within the main comment block.")
        # Restore backup if constructor block not found, to avoid partial changes
        import os
        os.replace('lib/bigint.test.js.backup', 'lib/bigint.test.js')
        print("Restored backup.")
else:
    print("Could not find the main comment block pattern.")
    # Restore backup if main pattern not found
    import os
    os.replace('lib/bigint.test.js.backup', 'lib/bigint.test.js')
    print("Restored backup.")
