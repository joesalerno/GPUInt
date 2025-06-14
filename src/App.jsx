import { useState, useRef } from 'react';
import { BigIntPrimitive } from '../lib/bigint.js';
import './App.css';

function App() {
  const [num1, setNum1] = useState("12345678901234567890");
  const [num2, setNum2] = useState("98765432109876543210");
  const [operation, setOperation] = useState("add"); // 'add', 'subtract', 'multiply', 'divide', 'remainder'
  const [forceCPU, setForceCPU] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [formatOptions, setFormatOptions] = useState({
    decimalPlaces: 2,
    useGrouping: false,
    style: 'decimal',
    currency: 'USD',
    currencyDisplay: 'symbol',
    notation: 'standard'
  });

  const canvasRef = useRef(null);

  const handleCalculate = () => {
    setResult("");
    setError("");

    if (!canvasRef.current) {
      setError("Error: Canvas element not found.");
      return;
    }

    try {
      const options = { forceCPU: forceCPU };
      const bigInt1 = new BigIntPrimitive(num1, canvasRef.current, options);
      const bigInt2 = new BigIntPrimitive(num2, canvasRef.current, options);

      let calcResult;
      switch (operation) {
        case 'add':
          calcResult = bigInt1.add(bigInt2);
          break;
        case 'subtract':
          calcResult = bigInt1.subtract(bigInt2);
          break;
        case 'multiply':
          calcResult = bigInt1.multiply(bigInt2);
          break;
        case 'divide':
          const divResult = bigInt1.divideAndRemainder(bigInt2);
          calcResult = divResult.quotient;
          break;
        case 'remainder':
          const remResult = bigInt1.divideAndRemainder(bigInt2);
          calcResult = remResult.remainder;
          break;
        default:
          throw new Error('Unknown operation selected');
      }
      setResult(calcResult.toString());
    } catch (e) {
      console.error("Calculation error:", e);
      setResult(''); // Clear previous result when an error occurs
      setError(`Error: ${e.message}${e.stack ? `\nStack: ${e.stack}` : ''}`);
    }
  };

  const handleFormat = () => {
    setResult("");
    setError("");

    if (!canvasRef.current) {
      setError("Error: Canvas element not found.");
      return;
    }

    try {
      const options = { forceCPU: forceCPU };
      const bigInt1 = new BigIntPrimitive(num1, canvasRef.current, options);
      // Ensure formatOptions state is correctly passed
      const formattedResult = bigInt1.toFormat(formatOptions);
      setResult(formattedResult);
    } catch (e) {
      console.error("Formatting error:", e);
      setResult(''); // Clear previous result
      setError(`Error: ${e.message}${e.stack ? `\nStack: ${e.stack}` : ''}`);
    }
  };

  const handleFormatOptionChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormatOptions(prevOptions => ({
      ...prevOptions,
      [name]: type === 'checkbox' ? checked : value
    }));
  };


  return (
    <div className="App">
      <h1>BigIntPrimitive Calculator</h1>
      <canvas id="webglCanvas" ref={canvasRef} style={{ display: 'none' }}></canvas>

      <div className="form-group">
        <label htmlFor="num1Input">Number 1:</label>
        <input
          type="text"
          id="num1Input"
          value={num1}
          onChange={(e) => setNum1(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="num2Input">Number 2:</label>
        <input
          type="text"
          id="num2Input"
          value={num2}
          onChange={(e) => setNum2(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="operationSelect">Operation:</label>
        <select
          id="operationSelect"
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
        >
          <option value="add">Addition (+)</option>
          <option value="subtract">Subtraction (-)</option>
          <option value="multiply">Multiplication (*)</option>
          <option value="divide">Division (/)</option>
          <option value="remainder">Remainder (%)</option>
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="forceCPUCheckbox">Force CPU:</label>
        <input
          type="checkbox"
          id="forceCPUCheckbox"
          checked={forceCPU}
          onChange={(e) => setForceCPU(e.target.checked)}
        />
      </div>

      <button onClick={handleCalculate} className="calculate-btn">Calculate</button>
      <button onClick={handleFormat} className="format-btn">Format Number 1</button>

      <div className="form-group">
        <h4>Formatting Options for Number 1:</h4>
        <label htmlFor="decimalPlacesInput">Decimal Places:</label>
        <input
          type="number"
          id="decimalPlacesInput"
          name="decimalPlaces"
          value={formatOptions.decimalPlaces}
          onChange={handleFormatOptionChange}
        />
      </div>
      <div className="form-group">
        <label htmlFor="useGroupingCheckbox">Use Grouping:</label>
        <input
          type="checkbox"
          id="useGroupingCheckbox"
          name="useGrouping"
          checked={formatOptions.useGrouping}
          onChange={handleFormatOptionChange}
        />
      </div>
      {/* Add more input fields for other Intl.NumberFormatOptions as needed */}
      {/* Example for 'style' */}
      <div className="form-group">
        <label htmlFor="styleSelect">Style:</label>
        <select
          id="styleSelect"
          name="style"
          value={formatOptions.style}
          onChange={handleFormatOptionChange}
        >
          <option value="decimal">Decimal</option>
          <option value="currency">Currency</option>
          <option value="percent">Percent</option>
        </select>
      </div>
      {/* Conditional rendering for currency options */}
      {formatOptions.style === 'currency' && (
        <>
          <div className="form-group">
            <label htmlFor="currencyInput">Currency Code:</label>
            <input
              type="text"
              id="currencyInput"
              name="currency"
              value={formatOptions.currency}
              onChange={handleFormatOptionChange}
            />
          </div>
          <div className="form-group">
            <label htmlFor="currencyDisplaySelect">Currency Display:</label>
            <select
              id="currencyDisplaySelect"
              name="currencyDisplay"
              value={formatOptions.currencyDisplay}
              onChange={handleFormatOptionChange}
            >
              <option value="symbol">Symbol</option>
              <option value="narrowSymbol">Narrow Symbol</option>
              <option value="code">Code</option>
              <option value="name">Name</option>
            </select>
          </div>
        </>
      )}
      {/* Example for 'notation' */}
      <div className="form-group">
        <label htmlFor="notationSelect">Notation:</label>
        <select
          id="notationSelect"
          name="notation"
          value={formatOptions.notation}
          onChange={handleFormatOptionChange}
        >
          <option value="standard">Standard</option>
          <option value="scientific">Scientific</option>
          <option value="engineering">Engineering</option>
          <option value="compact">Compact</option>
        </select>
      </div>


      <h3>Result:</h3>
      <pre id="resultArea" data-testid="result-area" className="result-area">{result}</pre>

      {error && (
        <>
          <h3>Error:</h3>
          <pre id="errorArea" data-testid="error-area" className="error-area">{error}</pre>
        </>
      )}
    </div>
  );
}

export default App;
