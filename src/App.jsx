import { useState } from 'react';
import { BigIntPrimitive } from '../lib/bigint.js';
import './App.css';

function App() {
  const [num1Str, setNum1Str] = useState('20000');
  const [num2Str, setNum2Str] = useState('5333');
  const [selectedOp, setSelectedOp] = useState('add');
  const [resultStr, setResultStr] = useState('');
  const [errorStr, setErrorStr] = useState('');
  const [forceCPUEnabled, setForceCPUEnabled] = useState(false);

  const handleCalculate = () => {
    console.log("React App: handleCalculate triggered",
                "num1Str:", num1Str,
                "num2Str:", num2Str,
                "selectedOp:", selectedOp,
                "forceCPUEnabled:", forceCPUEnabled);
    setResultStr('');
    setErrorStr('');
    const canvas = document.getElementById('webglCanvas');

    if (!canvas) {
      setErrorStr('Error: Canvas element with ID "webglCanvas" not found in index.html.');
      console.error('React App: Canvas element with ID "webglCanvas" not found.'); // Added console error
      return;
    }

    try {
      const options = { forceCPU: forceCPUEnabled };
      console.log("React App: Instantiating BigInt1 with value:", num1Str, "forceCPU:", forceCPUEnabled);
      const bigint1 = new BigIntPrimitive(num1Str, canvas, options);
      console.log("React App: Instantiating BigInt2 with value:", num2Str, "forceCPU:", forceCPUEnabled);
      const bigint2 = new BigIntPrimitive(num2Str, canvas, options);

      let calcResultString = '';
      let calcResultObject = null;

      switch (selectedOp) {
        case 'add':
          calcResultObject = bigint1.add(bigint2);
          calcResultString = calcResultObject.toString();
          break;
        case 'subtract':
          calcResultObject = bigint1.subtract(bigint2);
          calcResultString = calcResultObject.toString();
          break;
        case 'multiply':
          calcResultObject = bigint1.multiply(bigint2);
          calcResultString = calcResultObject.toString();
          break;
        case 'divide': {
          const divResult = bigint1.divideAndRemainder(bigint2);
          calcResultObject = { quotient: divResult.quotient, remainder: divResult.remainder }; // Store both for logging
          calcResultString = `Quotient: ${divResult.quotient.toString()}\nRemainder: ${divResult.remainder.toString()}`;
          break;
        }
        case 'remainder': {
          const remResult = bigint1.divideAndRemainder(bigint2);
          calcResultObject = remResult.remainder;
          calcResultString = calcResultObject.toString();
          break;
        }
        default:
          throw new Error('Invalid operation selected');
      }
      console.log("React App: Calculation result object (if applicable):",
                  calcResultObject ? (calcResultObject.limbs ? JSON.parse(JSON.stringify(calcResultObject)) : calcResultObject) : "N/A"); // Avoid stringifying non-BigInt objects directly if they are compound like divResult
      console.log("React App: Calculation result string:", calcResultString);
      setResultStr(calcResultString);
    } catch (e) {
      console.error("React App: Error during calculation:", e, e.stack);
      setErrorStr(e.message || String(e));
    }
  };

  return (
    <>
      <div style={{ fontFamily: 'sans-serif', margin: '20px' }}>
        <h2>BigIntPrimitive Interactive Tester (React)</h2>

        <div style={{ marginBottom: '10px' }}>
          <label htmlFor="num1React" style={{ marginRight: '5px' }}>Number 1: </label>
          <input
            type="text"
            id="num1React"
            value={num1Str}
            onChange={(e) => setNum1Str(e.target.value)}
            style={{ padding: '5px' }}
          />
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label htmlFor="num2React" style={{ marginRight: '5px' }}>Number 2: </label>
          <input
            type="text"
            id="num2React"
            value={num2Str}
            onChange={(e) => setNum2Str(e.target.value)}
            style={{ padding: '5px' }}
          />
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label htmlFor="operationReact" style={{ marginRight: '5px' }}>Operation: </label>
          <select
            id="operationReact"
            value={selectedOp}
            onChange={(e) => setSelectedOp(e.target.value)}
            style={{ padding: '5px' }}
          >
            <option value="add">Addition (+)</option>
            <option value="subtract">Subtraction (-)</option>
            <option value="multiply">Multiplication (*)</option>
            <option value="divide">Division (Q & R)</option>
            <option value="remainder">Remainder (%)</option>
          </select>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label htmlFor="forceCPUReact" style={{ marginRight: '5px' }}>Force CPU (for Add/Subtract): </label>
          <input
            type="checkbox"
            id="forceCPUReact"
            checked={forceCPUEnabled}
            onChange={(e) => setForceCPUEnabled(e.target.checked)}
          />
        </div>

        <button onClick={handleCalculate} style={{ padding: '8px 15px', marginTop: '10px' }}>
          Calculate
        </button>

        <h3>Result:</h3>
        <pre style={{ backgroundColor: '#f0f0f0', padding: '10px', minHeight: '30px', border: '1px solid #ccc', whiteSpace: 'pre-wrap' }}>
          {resultStr}
        </pre>

        {errorStr && (
          <>
            <h3 style={{ color: 'red' }}>Error:</h3>
            <pre style={{ color: 'red', backgroundColor: '#ffe0e0', padding: '10px', border: '1px solid red', whiteSpace: 'pre-wrap' }}>
              {errorStr}
            </pre>
          </>
        )}
      </div>
    </>
  );
}

export default App;
