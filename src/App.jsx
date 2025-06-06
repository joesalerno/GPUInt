import { useState, useEffect } from 'react';
import { BigIntPrimitive } from '../lib/bigint.js';
import './App.css';

function App() {
  const [num1Str, setNum1Str] = useState("12345678901234567890");
  const [num2Str, setNum2Str] = useState("98765432109876543210");
  const [sumStr, setSumStr] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = document.getElementById('webglCanvas');
    if (!canvas) {
      const errMsg = "Canvas element with ID 'webglCanvas' not found. Make sure it's in index.html.";
      console.error(errMsg);
      setError(errMsg);
      // Attempt to update testOutput even on error
      const outputDiv = document.getElementById('testOutput');
      if (outputDiv) {
        outputDiv.innerText = `Error: ${errMsg}`;
      }
      return;
    }

    let n1, n2, res;
    try {
      n1 = new BigIntPrimitive(num1Str, canvas);
      n2 = new BigIntPrimitive(num2Str, canvas);
      console.log("BigIntPrimitive instances created:", n1, n2);

      res = n1.add(n2);
      if (res) {
        console.log("Addition result:", res.toString());
        setSumStr(res.toString());
      } else {
        const errMsg = "BigInt addition returned null. Check console for details.";
        console.error(errMsg);
        setError(errMsg);
        res = { toString: () => "Error: addition failed" }; // Placeholder for output
      }
    } catch (e) {
      const errMsg = `Error during BigInt operations: ${e.message}`;
      console.error(errMsg, e);
      setError(errMsg);
      res = { toString: () => `Error: ${e.message}` }; // Placeholder for output
    }

    // Update a specific div for easier scraping
    const outputDiv = document.getElementById('testOutput');
    if (outputDiv) {
      outputDiv.innerText = `Num1: ${num1Str}\nNum2: ${num2Str}\nSum: ${sumStr || (res ? res.toString() : "Calculating...")}`;
      if (error) {
        outputDiv.innerText += `\nErrorState: ${error}`;
      }
    }

  }, [num1Str, num2Str, sumStr, error]); // Added sumStr and error to dependency array for completeness, though effect primarily runs once.

  return (
    <div className="App">
      <h1>BigInt Addition Test</h1>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      <div>
        <p>Number 1: {num1Str}</p>
        <p>Number 2: {num2Str}</p>
        <p>Sum: {sumStr}</p>
      </div>
      <div id="testOutput">
        {/* Content will be populated by useEffect */}
        Initializing...
      </div>
      {/* The canvas is used by WebGL but not necessarily displayed directly here unless wanted */}
      {/* <canvas id="webglCanvas" style={{ display: 'none' }}></canvas> */}
    </div>
  );
}

export default App;
