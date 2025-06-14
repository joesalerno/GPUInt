import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event'; // Import userEvent
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'; // Added afterEach

import App from './App'; // The component to test
// When BigIntPrimitive is imported, it will be the mock due to vi.mock hoisting
import { BigIntPrimitive as MockedBigIntPrimitiveConstructor } from '../lib/bigint.js';

vi.mock('../lib/bigint.js', () => {
  // This is THE mock constructor that Vitest will use for BigIntPrimitive.
  const TheMockConstructor = vi.fn();

  // Attach static method mocks directly TO THIS FUNCTION OBJECT.
  TheMockConstructor.add = vi.fn();
  TheMockConstructor.subtract = vi.fn();
  TheMockConstructor.multiply = vi.fn();
  TheMockConstructor.divideAndRemainder = vi.fn();

  // Implementation for when `new TheMockConstructor()` is called
  TheMockConstructor.mockImplementation((value, canvas, options) => {
    // Instances delegate their method calls to the static mocks on TheMockConstructor
    return {
      add: (...args) => TheMockConstructor.add(...args),
      subtract: (...args) => TheMockConstructor.subtract(...args),
      multiply: (...args) => TheMockConstructor.multiply(...args),
      divideAndRemainder: (...args) => TheMockConstructor.divideAndRemainder(...args),
      // Instance-specific toString, based on the value it was constructed with.
      toString: vi.fn().mockReturnValue(String(value || 'mockInstanceVal')),
      abs: vi.fn().mockImplementation(function() { return this; }),
      negate: vi.fn().mockImplementation(function() { return this; }),
      isZero: vi.fn().mockReturnValue(false),
    };
  });

  return { BigIntPrimitive: TheMockConstructor }; // Export this specific function
});

describe('App Component', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    userEvent.setup();
    MockedBigIntPrimitiveConstructor.mockClear();

    MockedBigIntPrimitiveConstructor.add.mockReset();
    MockedBigIntPrimitiveConstructor.subtract.mockReset();
    MockedBigIntPrimitiveConstructor.multiply.mockReset();
    MockedBigIntPrimitiveConstructor.divideAndRemainder.mockReset();

    // Spy on console.error before each test and provide a mock implementation
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console.error after each test
    consoleErrorSpy.mockRestore();
  });

  it('renders initial UI elements correctly', () => {
    render(<App />);
    expect(screen.getByLabelText(/Number 1:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Number 2:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Operation:/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Force CPU:/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calculate/i })).toBeInTheDocument();
    expect(screen.getByText('Result:')).toBeInTheDocument(); // h3
    expect(document.getElementById('resultArea')).toBeInTheDocument();
    expect(document.getElementById('webglCanvas')).toBeInTheDocument();
  });

  it('performs simple addition (WebGL Path) and displays result', async () => {
    MockedBigIntPrimitiveConstructor.add.mockReturnValue({ toString: () => "30" });
    render(<App />);

    const num1Input_add = screen.getByLabelText(/Number 1:/i);
    await userEvent.clear(num1Input_add);
    await userEvent.type(num1Input_add, '10');

    const num2Input_add = screen.getByLabelText(/Number 2:/i);
    await userEvent.clear(num2Input_add);
    await userEvent.type(num2Input_add, '20');

    await userEvent.selectOptions(screen.getByLabelText(/Operation:/i), 'add');
    await waitFor(() => expect(screen.getByLabelText(/Operation:/i)).toHaveValue('add'));

    await userEvent.click(screen.getByRole('button', { name: /Calculate/i }));

    await waitFor(() => {
      expect(screen.getByText("30")).toBeInTheDocument();
    });

    expect(MockedBigIntPrimitiveConstructor).toHaveBeenCalledTimes(2);
    expect(MockedBigIntPrimitiveConstructor).toHaveBeenCalledWith(
      '10',
      expect.any(HTMLCanvasElement),
      { forceCPU: false }
    );
    expect(MockedBigIntPrimitiveConstructor).toHaveBeenCalledWith(
      '20',
      expect.any(HTMLCanvasElement),
      { forceCPU: false }
    );
    expect(MockedBigIntPrimitiveConstructor.add).toHaveBeenCalledTimes(1);
    expect(MockedBigIntPrimitiveConstructor.add).toHaveBeenCalledWith(expect.objectContaining({
      toString: expect.any(Function)
    }));
  });

  it('performs simple subtraction (CPU Path) and displays result', async () => {
    MockedBigIntPrimitiveConstructor.subtract.mockReturnValue({ toString: () => "40" });
    render(<App />);

    const num1Input_sub = screen.getByLabelText(/Number 1:/i);
    await userEvent.clear(num1Input_sub);
    await userEvent.type(num1Input_sub, '50');

    const num2Input_sub = screen.getByLabelText(/Number 2:/i);
    await userEvent.clear(num2Input_sub);
    await userEvent.type(num2Input_sub, '10');

    await userEvent.selectOptions(screen.getByLabelText(/Operation:/i), 'subtract');
    await waitFor(() => expect(screen.getByLabelText(/Operation:/i)).toHaveValue('subtract'));

    await userEvent.click(screen.getByLabelText(/Force CPU:/i));
    await userEvent.click(screen.getByRole('button', { name: /Calculate/i }));

    await waitFor(() => {
      expect(screen.getByTestId('result-area').textContent).toBe("40");
    });

    expect(MockedBigIntPrimitiveConstructor).toHaveBeenCalledTimes(2);
    expect(MockedBigIntPrimitiveConstructor).toHaveBeenCalledWith(
      '50',
      expect.any(HTMLCanvasElement),
      { forceCPU: true }
    );
    expect(MockedBigIntPrimitiveConstructor).toHaveBeenCalledWith(
      '10',
      expect.any(HTMLCanvasElement),
      { forceCPU: true }
    );
    expect(MockedBigIntPrimitiveConstructor.subtract).toHaveBeenCalledTimes(1);
    expect(MockedBigIntPrimitiveConstructor.subtract).toHaveBeenCalledWith(expect.objectContaining({
      toString: expect.any(Function)
    }));
  });

  it('handles error for invalid input', async () => {
    const expectedError = new Error("Invalid BigInt string format");
    MockedBigIntPrimitiveConstructor.mockImplementationOnce(() => {
      throw expectedError;
    });

    render(<App />);
    const num1Input = screen.getByLabelText(/Number 1:/i);
    await userEvent.clear(num1Input);
    await userEvent.type(num1Input, 'abc');

    await userEvent.click(screen.getByRole('button', { name: /Calculate/i }));

    await waitFor(async () => {
      const errorDisplay = screen.queryByTestId('error-area');
      expect(errorDisplay).toBeInTheDocument();
      expect(errorDisplay).toHaveTextContent(/Invalid BigInt string format/i);
      // Check if console.error was called with the specific error
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith("Calculation error:", expect.objectContaining({ message: "Invalid BigInt string format" }));
    });

    const resultArea_invalidInput = screen.getByTestId('result-area');
    expect(resultArea_invalidInput.textContent).toBe('');
    expect(MockedBigIntPrimitiveConstructor).toHaveBeenCalledTimes(1);
  });

  it('handles division by zero error', async () => {
    const expectedError = new Error("Division by zero");
    MockedBigIntPrimitiveConstructor.divideAndRemainder.mockImplementation(() => {
      throw expectedError;
    });

    render(<App />);
    const num1Input_div = screen.getByLabelText(/Number 1:/i);
    await userEvent.clear(num1Input_div);
    await userEvent.type(num1Input_div, '10');

    const num2Input_div = screen.getByLabelText(/Number 2:/i);
    await userEvent.clear(num2Input_div);
    await userEvent.type(num2Input_div, '0');

    await userEvent.selectOptions(screen.getByLabelText(/Operation:/i), 'divide');
    await waitFor(() => expect(screen.getByLabelText(/Operation:/i)).toHaveValue('divide'));

    await userEvent.click(screen.getByRole('button', { name: /Calculate/i }));

    await waitFor(async () => {
      const errorDisplay = screen.queryByTestId('error-area');
      expect(errorDisplay).toBeInTheDocument();
      expect(errorDisplay).toHaveTextContent(/Division by zero/i);
      // Check if console.error was called
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith("Calculation error:", expect.objectContaining({ message: "Division by zero" }));
    });

    const resultArea_divByZero = screen.getByTestId('result-area');
    expect(resultArea_divByZero.textContent).toBe('');

    expect(MockedBigIntPrimitiveConstructor).toHaveBeenCalledTimes(2);
    expect(MockedBigIntPrimitiveConstructor.divideAndRemainder).toHaveBeenCalledTimes(1);
    expect(MockedBigIntPrimitiveConstructor.divideAndRemainder).toHaveBeenCalledWith(expect.objectContaining({
      toString: expect.any(Function)
    }));
  });

});
