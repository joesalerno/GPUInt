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

  // States for Division Test 1
  const [div1DividendStr, setDiv1DividendStr] = useState("12345");
  const [div1DivisorStr, setDiv1DivisorStr] = useState("67");
  const [div1QuotientStr, setDiv1QuotientStr] = useState("");
  const [div1RemainderStr, setDiv1RemainderStr] = useState("");
  const [div1ErrorStr, setDiv1ErrorStr] = useState("");

  // States for Division Test 2
  const [div2DividendStr, setDiv2DividendStr] = useState("103");
  const [div2DivisorStr, setDiv2DivisorStr] = useState("-20");
  const [div2QuotientStr, setDiv2QuotientStr] = useState("");
  const [div2RemainderStr, setDiv2RemainderStr] = useState("");
  const [div2ErrorStr, setDiv2ErrorStr] = useState("");

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
      setDiv1ErrorStr(errMsg);
      setDiv2ErrorStr(errMsg);
      const outputDiv = document.getElementById('testOutput');
      if (outputDiv) outputDiv.innerText = `Error: ${errMsg}`;
      return;
    }

    let outputText = "";

    // Addition Test
    try {
      setAddErrorStr(""); // Clear previous error
      const n1 = new BigIntPrimitive(addNum1Str, canvas);
      const n2 = new BigIntPrimitive(addNum2Str, canvas);
      const res = n1.add(n2);
      setSumStr(res.toString());
      outputText += `Addition: ${addNum1Str} + ${addNum2Str} = ${res.toString()}\n`;
    } catch (e) {
      console.error("Error during Addition:", e);
      setAddErrorStr(e.message);
      setSumStr("Error");
      outputText += `Addition: ${addNum1Str} + ${addNum2Str} = Error (${e.message})\n`;
    }

    // Subtraction Test 1
    try {
      setSub1ErrorStr(""); // Clear previous error
      const val1 = new BigIntPrimitive(sub1Num1Str, canvas);
      const val2 = new BigIntPrimitive(sub1Num2Str, canvas);
      const diff1 = val1.subtract(val2);
      setSub1ResultStr(diff1.toString());
      outputText += `Subtraction 1: ${sub1Num1Str} - ${sub1Num2Str} = ${diff1.toString()}\n`;
    } catch (e) {
      console.error("Error during Subtraction 1:", e);
      setSub1ErrorStr(e.message);
      setSub1ResultStr("Error");
      outputText += `Subtraction 1: ${sub1Num1Str} - ${sub1Num2Str} = Error (${e.message})\n`;
    }

    // Subtraction Test 2
    try {
      setSub2ErrorStr(""); // Clear previous error
      const val3 = new BigIntPrimitive(sub2Num1Str, canvas);
      const val4 = new BigIntPrimitive(sub2Num2Str, canvas);
      const diff2 = val3.subtract(val4);
      setSub2ResultStr(diff2.toString());
      outputText += `Subtraction 2: ${sub2Num1Str} - ${sub2Num2Str} = ${diff2.toString()}\n`;
    } catch (e) {
      console.error("Error during Subtraction 2:", e);
      setSub2ErrorStr(e.message);
      setSub2ResultStr("Error");
      outputText += `Subtraction 2: ${sub2Num1Str} - ${sub2Num2Str} = Error (${e.message})\n`;
    }

    // Multiplication Test 1 (positive * positive)
    try {
      setMul1ErrorStr(""); // Clear previous error
      const mVal1 = new BigIntPrimitive(mul1Num1Str, canvas);
      const mVal2 = new BigIntPrimitive(mul1Num2Str, canvas);
      const prod1 = mVal1.multiply(mVal2);
      setMul1ResultStr(prod1.toString());
      outputText += `Multiplication 1: ${mul1Num1Str} * ${mul1Num2Str} = ${prod1.toString()}\n`;
    } catch (e) {
      console.error("Error during Multiplication 1:", e);
      setMul1ErrorStr(e.message);
      setMul1ResultStr("Error");
      outputText += `Multiplication 1: ${mul1Num1Str} * ${mul1Num2Str} = Error (${e.message})\n`;
    }

    // Multiplication Test 2 (positive * negative)
    try {
      setMul2ErrorStr(""); // Clear previous error
      const mVal3 = new BigIntPrimitive(mul2Num1Str, canvas);
      const mVal4 = new BigIntPrimitive(mul2Num2Str, canvas);
      const prod2 = mVal3.multiply(mVal4);
      setMul2ResultStr(prod2.toString());
      outputText += `Multiplication 2: ${mul2Num1Str} * ${mul2Num2Str} = ${prod2.toString()}\n`;
    } catch (e) {
      console.error("Error during Multiplication 2:", e);
      setMul2ErrorStr(e.message);
      setMul2ResultStr("Error");
      outputText += `Multiplication 2: ${mul2Num1Str} * ${mul2Num2Str} = Error (${e.message})\n`;
    }

    // Division Test 1
    try {
      setDiv1ErrorStr(""); // Clear previous error
      const d1Val1 = new BigIntPrimitive(div1DividendStr, canvas);
      const d1Val2 = new BigIntPrimitive(div1DivisorStr, canvas);
      const { quotient, remainder } = d1Val1.divide(d1Val2);
      setDiv1QuotientStr(quotient.toString());
      setDiv1RemainderStr(remainder.toString());
      outputText += `Division 1: ${div1DividendStr} / ${div1DivisorStr} = Q: ${quotient.toString()}, R: ${remainder.toString()}\n`;
    } catch (e) {
      console.error("Error during Division 1:", e);
      setDiv1ErrorStr(e.message);
      setDiv1QuotientStr("Error");
      setDiv1RemainderStr("Error");
      outputText += `Division 1: ${div1DividendStr} / ${div1DivisorStr} = Error (${e.message})\n`;
    }

    // Division Test 2
    try {
      setDiv2ErrorStr(""); // Clear previous error
      const d2Val1 = new BigIntPrimitive(div2DividendStr, canvas);
      const d2Val2 = new BigIntPrimitive(div2DivisorStr, canvas);
      const { quotient, remainder } = d2Val1.divide(d2Val2);
      setDiv2QuotientStr(quotient.toString());
      setDiv2RemainderStr(remainder.toString());
      outputText += `Division 2: ${div2DividendStr} / ${div2DivisorStr} = Q: ${quotient.toString()}, R: ${remainder.toString()}\n`;
    } catch (e) {
      console.error("Error during Division 2:", e);
      setDiv2ErrorStr(e.message);
      setDiv2QuotientStr("Error");
      setDiv2RemainderStr("Error");
      outputText += `Division 2: ${div2DividendStr} / ${div2DivisorStr} = Error (${e.message})\n`;
    }

    const outputDiv = document.getElementById('testOutput');
    if (outputDiv) {
      outputDiv.innerText = outputText;
      if (addErrorStr) outputDiv.innerText += `\nAdd Error: ${addErrorStr}`;
      if (sub1ErrorStr) outputDiv.innerText += `\nSub1 Error: ${sub1ErrorStr}`;
      if (sub2ErrorStr) outputDiv.innerText += `\nSub2 Error: ${sub2ErrorStr}`;
      if (mul1ErrorStr) outputDiv.innerText += `\nMul1 Error: ${mul1ErrorStr}`;
      if (mul2ErrorStr) outputDiv.innerText += `\nMul2 Error: ${mul2ErrorStr}`;
      if (div1ErrorStr) outputDiv.innerText += `\nDiv1 Error: ${div1ErrorStr}`;
      if (div2ErrorStr) outputDiv.innerText += `\nDiv2 Error: ${div2ErrorStr}`;
    }

  }, [addNum1Str, addNum2Str, sub1Num1Str, sub1Num2Str, sub2Num1Str, sub2Num2Str, mul1Num1Str, mul1Num2Str, mul2Num1Str, mul2Num2Str, div1DividendStr, div1DivisorStr, div2DividendStr, div2DivisorStr]);

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

      <div>
        <h2>Division Test 1 (Positive / Positive)</h2>
        <p>{div1DividendStr} / {div1DivisorStr}</p>
        <p>Quotient: {div1QuotientStr}</p>
        <p>Remainder: {div1RemainderStr}</p>
        {div1ErrorStr && <p style={{ color: 'red' }}>Error: {div1ErrorStr}</p>}
      </div>

      <div>
        <h2>Division Test 2 (Positive / Negative)</h2>
        <p>{div2DividendStr} / {div2DivisorStr}</p>
        <p>Quotient: {div2QuotientStr}</p>
        <p>Remainder: {div2RemainderStr}</p>
        {div2ErrorStr && <p style={{ color: 'red' }}>Error: {div2ErrorStr}</p>}
      </div>

      <div id="testOutput" style={{ whiteSpace: 'pre-wrap', marginTop: '20px', border: '1px solid #ccc', padding: '10px' }}>
        Initializing...
      </div>
    </div>
  );
}

export default App;
