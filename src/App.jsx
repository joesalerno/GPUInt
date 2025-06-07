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

  // States for Multiplication Test 1 (positive * positive)
  const [mul1Num1Str, setMul1Num1Str] = useState("12345");
  const [mul1Num2Str, setMul1Num2Str] = useState("54321");
  const [mul1ResultStr, setMul1ResultStr] = useState("");
  const [mul1ErrorStr, setMul1ErrorStr] = useState("");

  // States for Multiplication Test 2 (positive * negative)
  const [mul2Num1Str, setMul2Num1Str] = useState("1000");
  const [mul2Num2Str, setMul2Num2Str] = useState("-25");
  const [mul2ResultStr, setMul2ResultStr] = useState("");
  const [mul2ErrorStr, setMul2ErrorStr] = useState("");

  useEffect(() => {
    const canvas = document.getElementById('webglCanvas');
    if (!canvas) {
      const errMsg = "Canvas element with ID 'webglCanvas' not found. Make sure it's in index.html.";
      console.error(errMsg);
      setAddErrorStr(errMsg);
      setSub1ErrorStr(errMsg);
      setSub2ErrorStr(errMsg);
      setMul1ErrorStr(errMsg);
      setMul2ErrorStr(errMsg);
      const outputDiv = document.getElementById('testOutput');
      if (outputDiv) outputDiv.innerText = `Error: ${errMsg}`;
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
        setAddErrorStr("BigInt addition returned error. Check console.");
        outputText += `Addition: ${addNum1Str} + ${addNum2Str} = Error\n`;
      }
    } catch (e) {
      console.error("Error during BigInt addition:", e);
      setAddErrorStr(`Error: ${e.message}`);
      outputText += `Addition: ${addNum1Str} + ${addNum2Str} = Error (${e.message})\n`;
    }

    // Subtraction Test 1
    try {
      const val1 = new BigIntPrimitive(sub1Num1Str, canvas);
      const val2 = new BigIntPrimitive(sub1Num2Str, canvas);
      const diff1 = val1.subtract(val2);
      if (diff1) {
        setSub1ResultStr(diff1.toString());
        outputText += `Subtraction 1: ${sub1Num1Str} - ${sub1Num2Str} = ${diff1.toString()}\n`;
      } else {
        setSub1ErrorStr("BigInt subtraction (1) returned error. Check console.");
        outputText += `Subtraction 1: ${sub1Num1Str} - ${sub1Num2Str} = Error\n`;
      }
    } catch (e) {
      console.error("Error during BigInt subtraction (1):", e);
      setSub1ErrorStr(`Error: ${e.message}`);
      outputText += `Subtraction 1: ${sub1Num1Str} - ${sub1Num2Str} = Error (${e.message})\n`;
    }

    // Subtraction Test 2
    try {
      const val3 = new BigIntPrimitive(sub2Num1Str, canvas);
      const val4 = new BigIntPrimitive(sub2Num2Str, canvas);
      const diff2 = val3.subtract(val4);
      if (diff2) {
        setSub2ResultStr(diff2.toString());
        outputText += `Subtraction 2: ${sub2Num1Str} - ${sub2Num2Str} = ${diff2.toString()}\n`;
      } else {
        setSub2ErrorStr("BigInt subtraction (2) returned error. Check console.");
        outputText += `Subtraction 2: ${sub2Num1Str} - ${sub2Num2Str} = Error\n`;
      }
    } catch (e) {
      console.error("Error during BigInt subtraction (2):", e);
      setSub2ErrorStr(`Error: ${e.message}`);
      outputText += `Subtraction 2: ${sub2Num1Str} - ${sub2Num2Str} = Error (${e.message})\n`;
    }

    // Multiplication Test 1 (positive * positive)
    try {
      const mVal1 = new BigIntPrimitive(mul1Num1Str, canvas);
      const mVal2 = new BigIntPrimitive(mul1Num2Str, canvas);
      const prod1 = mVal1.multiply(mVal2);
      if (prod1) {
        setMul1ResultStr(prod1.toString());
        outputText += `Multiplication 1: ${mul1Num1Str} * ${mul1Num2Str} = ${prod1.toString()}\n`;
      } else {
        setMul1ErrorStr("BigInt multiplication (1) returned error. Check console.");
        outputText += `Multiplication 1: ${mul1Num1Str} * ${mul1Num2Str} = Error\n`;
      }
    } catch (e) {
      console.error("Error during BigInt multiplication (1):", e);
      setMul1ErrorStr(`Error: ${e.message}`);
      outputText += `Multiplication 1: ${mul1Num1Str} * ${mul1Num2Str} = Error (${e.message})\n`;
    }

    // Multiplication Test 2 (positive * negative)
    try {
      const mVal3 = new BigIntPrimitive(mul2Num1Str, canvas);
      const mVal4 = new BigIntPrimitive(mul2Num2Str, canvas);
      const prod2 = mVal3.multiply(mVal4);
      if (prod2) {
        setMul2ResultStr(prod2.toString());
        outputText += `Multiplication 2: ${mul2Num1Str} * ${mul2Num2Str} = ${prod2.toString()}\n`;
      } else {
        setMul2ErrorStr("BigInt multiplication (2) returned error. Check console.");
        outputText += `Multiplication 2: ${mul2Num1Str} * ${mul2Num2Str} = Error\n`;
      }
    } catch (e) {
      console.error("Error during BigInt multiplication (2):", e);
      setMul2ErrorStr(`Error: ${e.message}`);
      outputText += `Multiplication 2: ${mul2Num1Str} * ${mul2Num2Str} = Error (${e.message})\n`;
    }

    const outputDiv = document.getElementById('testOutput');
    if (outputDiv) {
      outputDiv.innerText = outputText;
      if (addErrorStr) outputDiv.innerText += `\nAdd Error: ${addErrorStr}`;
      if (sub1ErrorStr) outputDiv.innerText += `\nSub1 Error: ${sub1ErrorStr}`;
      if (sub2ErrorStr) outputDiv.innerText += `\nSub2 Error: ${sub2ErrorStr}`;
      if (mul1ErrorStr) outputDiv.innerText += `\nMul1 Error: ${mul1ErrorStr}`;
      if (mul2ErrorStr) outputDiv.innerText += `\nMul2 Error: ${mul2ErrorStr}`;
    }

  }, [addNum1Str, addNum2Str, sub1Num1Str, sub1Num2Str, sub2Num1Str, sub2Num2Str, mul1Num1Str, mul1Num2Str, mul2Num1Str, mul2Num2Str]);

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

      <div>
        <h2>Multiplication Test 1 (Positive * Positive)</h2>
        <p>{mul1Num1Str} * {mul1Num2Str} = {mul1ResultStr}</p>
        {mul1ErrorStr && <p style={{ color: 'red' }}>Error: {mul1ErrorStr}</p>}
      </div>

      <div>
        <h2>Multiplication Test 2 (Positive * Negative)</h2>
        <p>{mul2Num1Str} * {mul2Num2Str} = {mul2ResultStr}</p>
        {mul2ErrorStr && <p style={{ color: 'red' }}>Error: {mul2ErrorStr}</p>}
      </div>

      <div id="testOutput" style={{ whiteSpace: 'pre-wrap', marginTop: '20px', border: '1px solid #ccc', padding: '10px' }}>
        Initializing...
      </div>
    </div>
  );
}

export default App;
