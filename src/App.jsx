import { useState, useEffect } from 'react';
import { BigIntPrimitive } from '../lib/bigint.js';
import './App.css';

function App() {
  // States for Addition Test
  const [addNum1Str, setAddNum1Str] = useState("12345678901234567890");
  const [addNum2Str, setAddNum2Str] = useState("98765432109876543210");
  const [sumStr, setSumStr] = useState("");
  const [addErrorStr, setAddErrorStr] = useState("");

  // States for Subtraction Test 1 (positive result)
  const [sub1Num1Str, setSub1Num1Str] = useState("98765432109876543210");
  const [sub1Num2Str, setSub1Num2Str] = useState("12345678901234567890");
  const [sub1ResultStr, setSub1ResultStr] = useState("");
  const [sub1ErrorStr, setSub1ErrorStr] = useState("");

  // States for Subtraction Test 2 (negative result)
  const [sub2Num1Str, setSub2Num1Str] = useState("100");
  const [sub2Num2Str, setSub2Num2Str] = useState("10000");
  const [sub2ResultStr, setSub2ResultStr] = useState("");
  const [sub2ErrorStr, setSub2ErrorStr] = useState("");

  useEffect(() => {
    const canvas = document.getElementById('webglCanvas');
    if (!canvas) {
      const errMsg = "Canvas element with ID 'webglCanvas' not found. Make sure it's in index.html.";
      console.error(errMsg);
      setAddErrorStr(errMsg);
      setSub1ErrorStr(errMsg);
      setSub2ErrorStr(errMsg);
      // Attempt to update testOutput even on error
      const outputDiv = document.getElementById('testOutput');
      if (outputDiv) {
        outputDiv.innerText = `Error: ${errMsg}`;
      }
      return;
    }

    let outputText = "";

    // Addition Test
    try {
      const n1 = new BigIntPrimitive(addNum1Str, canvas);
      const n2 = new BigIntPrimitive(addNum2Str, canvas);
      const res = n1.add(n2);
      if (res) {
        setSumStr(res.toString());
        outputText += `Addition: ${addNum1Str} + ${addNum2Str} = ${res.toString()}\n`;
      } else {
        setAddErrorStr("BigInt addition returned null or error. Check console.");
        outputText += `Addition: ${addNum1Str} + ${addNum2Str} = Error (null result)\n`;
      }
    } catch (e) {
      console.error("Error during BigInt addition:", e);
      setAddErrorStr(`Error: ${e.message}`);
      outputText += `Addition: ${addNum1Str} + ${addNum2Str} = Error (${e.message})\n`;
    }

    // Subtraction Test 1 (positive result)
    try {
      const val1 = new BigIntPrimitive(sub1Num1Str, canvas);
      const val2 = new BigIntPrimitive(sub1Num2Str, canvas);
      const difference = val1.subtract(val2);
      if (difference) {
        setSub1ResultStr(difference.toString());
        outputText += `Subtraction 1: ${sub1Num1Str} - ${sub1Num2Str} = ${difference.toString()}\n`;
      } else {
        setSub1ErrorStr("BigInt subtraction (1) returned null. Check console.");
        outputText += `Subtraction 1: ${sub1Num1Str} - ${sub1Num2Str} = Error (null result)\n`;
      }
    } catch (e) {
      console.error("Error during BigInt subtraction (1):", e);
      setSub1ErrorStr(`Error: ${e.message}`);
      outputText += `Subtraction 1: ${sub1Num1Str} - ${sub1Num2Str} = Error (${e.message})\n`;
    }

    // Subtraction Test 2 (negative result)
    try {
      const val3 = new BigIntPrimitive(sub2Num1Str, canvas);
      const val4 = new BigIntPrimitive(sub2Num2Str, canvas);
      const difference2 = val3.subtract(val4);
      if (difference2) {
        setSub2ResultStr(difference2.toString());
        outputText += `Subtraction 2: ${sub2Num1Str} - ${sub2Num2Str} = ${difference2.toString()}\n`;
      } else {
        setSub2ErrorStr("BigInt subtraction (2) returned null. Check console.");
        outputText += `Subtraction 2: ${sub2Num1Str} - ${sub2Num2Str} = Error (null result)\n`;
      }
    } catch (e) {
      console.error("Error during BigInt subtraction (2):", e);
      setSub2ErrorStr(`Error: ${e.message}`);
      outputText += `Subtraction 2: ${sub2Num1Str} - ${sub2Num2Str} = Error (${e.message})\n`;
    }

    // Update a specific div for easier scraping (if needed by test automation)
    const outputDiv = document.getElementById('testOutput');
    if (outputDiv) {
      outputDiv.innerText = outputText;
      if (addErrorStr) outputDiv.innerText += `Add Error: ${addErrorStr}\n`;
      if (sub1ErrorStr) outputDiv.innerText += `Sub1 Error: ${sub1ErrorStr}\n`;
      if (sub2ErrorStr) outputDiv.innerText += `Sub2 Error: ${sub2ErrorStr}\n`;
    }

  }, [addNum1Str, addNum2Str, sub1Num1Str, sub1Num2Str, sub2Num1Str, sub2Num2Str]); // Dependency array

  return (
    <div className="App">
      <h1>BigInt Operations Test</h1>

      <div>
        <h2>Addition Test</h2>
        <p>{addNum1Str} + {addNum2Str} = {sumStr}</p>
        {addErrorStr && <p style={{ color: 'red' }}>Error: {addErrorStr}</p>}
      </div>

      <div>
        <h2>Subtraction Test 1 (Positive Result)</h2>
        <p>{sub1Num1Str} - {sub1Num2Str} = {sub1ResultStr}</p>
        {sub1ErrorStr && <p style={{ color: 'red' }}>Error: {sub1ErrorStr}</p>}
      </div>

      <div>
        <h2>Subtraction Test 2 (Negative Result)</h2>
        <p>{sub2Num1Str} - {sub2Num2Str} = {sub2ResultStr}</p>
        {sub2ErrorStr && <p style={{ color: 'red' }}>Error: {sub2ErrorStr}</p>}
      </div>

      <div id="testOutput" style={{ whiteSpace: 'pre-wrap', marginTop: '20px', border: '1px solid #ccc', padding: '10px' }}>
        Initializing...
      </div>
    </div>
  );
}

export default App;
