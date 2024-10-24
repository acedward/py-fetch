importScripts('https://cdn.jsdelivr.net/pyodide/v0.22.1/full/pyodide.js');


// FetchPage function implementation
/**
 * Synchronously fetches a web page by polling for messages.
 *
 * @param url - The URL of the page to fetch.
 * @param headers - The headers to include in the request.
 * @param method - The HTTP method ('GET' or 'POST').
 * @param body - The body of the request (optional).
 * @returns The page's body as a string.
 * @throws Will throw an error if the HTTP request fails.
 */
const fetchPage = (
    url,
    headers,
    method,
    body = null,
  ) => {
    console.log('fetchPage called with url:', url);
    console.log('fetchPage called with headers:', headers);
    console.log('fetchPage called with method:', method);
    if (body) {
      console.log('fetchPage called with body:', body);
    }
  
    const filteredHeaders = {};
    for (const [key, value] of Object.entries(headers.toJs())) {
      if (typeof key === 'string' && typeof value === 'string') {
        filteredHeaders[key] = value;
      }
    }
    console.log('filteredHeaders', filteredHeaders);
  
    // Process body based on its type
    let processedBody = null;
    if (body) {
      if (typeof body === 'string') {
        processedBody = body; // If it's a string, use it directly
      } else if (body && typeof body.toJs === 'function') {
        // Check if body has a toJs method, indicating it might be a Proxy
        try {
          const jsBody = body.toJs();
          processedBody = {};
          const proxyEntries = Object.entries(jsBody);
          for (const [key, value] of proxyEntries) {
            processedBody[key] = value;
          }
        } catch (error) {
          console.error('Error processing Proxy-like body:', error);
        }
      } else if (typeof body === 'object') {
        processedBody = JSON.stringify(body); // Convert JSON object to string
      }
    }
    console.log('Final processedBody:', processedBody);
  
    const bufferSize = 10 * 512 * 1024; // Fixed buffer size of 512kb
    const sharedBuffer = new SharedArrayBuffer(bufferSize);
    const syncArray = new Int32Array(sharedBuffer, 0, 1);
    const dataArray = new Uint8Array(sharedBuffer, 4);
  
    try {
      self.postMessage({
        type: 'page', // Updated message type
        method, // Include method in the message
        meta: url,
        headers: filteredHeaders,
        body: processedBody, // Use processed body
        sharedBuffer,
      });

      function copy(src)  {
        var dst = new ArrayBuffer(src.byteLength);
        new Uint8Array(dst).set(new Uint8Array(src));
        return dst;
    }
    
  
    function decodeFromSharedBuffer(sharedBuffer) {
        const decoder = new TextDecoder()
        const copyLength = sharedBuffer.byteLength;
      
        // Create a temporary ArrayBuffer and copy the contents of the shared buffer
        // into it.
        const tempBuffer = new ArrayBuffer(copyLength)
        const tempView = new Uint8Array(tempBuffer)
      
        let sharedView = new Uint8Array(sharedBuffer)
        if (sharedBuffer.byteLength != copyLength) {
          sharedView = sharedView.subarray(0, copyLength)
        }
        tempView.set(sharedView)
      
        return decoder.decode(tempBuffer)
      }

      console.log('Posted message to main thread, waiting for response...');
  
      Atomics.wait(syncArray, 0, 0);
      console.log('atomic wait done with status: ', syncArray[0]);
      console.log({dataArray})
      if (syncArray[0] === -1) {
        // const textDecoder = new TextDecoder();
        const errorMessage = decodeFromSharedBuffer(sharedBuffer); // textDecoder.decode(copy(dataArray));
        console.error('Error fetching page:', errorMessage);
        throw new Error(errorMessage);
      }
  
    //   const textDecoder = new TextDecoder();
      let result = decodeFromSharedBuffer(sharedBuffer); // textDecoder.decode(dataArray);
      console.log({ result, sharedBuffer })
      result = result.replace(/\0/g, '').trim();
  
      console.log(`Received data of length: ${result.length}`);
      console.log('result: ', result);
  
      return result;
    } catch (e) {
      console.error('An error occurred:', e);
      throw new Error(
        'Failed to fetch page: ' +
          (e instanceof Error ? e.message : 'Unknown error'),
      );
    }
  };

  async function initializePyodide() {
    self.pyodide = await loadPyodide();
    await self.pyodide.loadPackage("micropip");
    const micropip = self.pyodide.pyimport("micropip");
    await micropip.install('requests');
    self.pyodide.globals.set('custom_fetch', fetchPage);
    return self.pyodide;
}

let pyodideReadyPromise = initializePyodide();


self.onmessage = async function(event) {
    await pyodideReadyPromise;
    
    const url = event.data.url;
    
    const pythonScript = `
import requests
import json
from requests.models import Response

url = "${url}"


class CustomSession(requests.Session):
    def request(self, method, url, *args, **kwargs):
        try:
            print('Fetching URL:', url)
            headers = kwargs.get('headers', {})
            body = kwargs.get('data', None) or kwargs.get('json', None)
            print('headers', headers);
            print('method', method);
            if body:
                print('body', body);
            response_content = custom_fetch(url, headers, method, body)
            response = Response()
            response._content = response_content.encode(encoding="utf-8")
            response.status_code = 200  # Assuming success
            return response
        except Exception as e:
            print(f"CustomSession request error: {e}")
            raise

requests.get = CustomSession().get
requests.post = CustomSession().post

try:
    response = requests.get(url)
    response.raise_for_status()  # Raises an HTTPError for bad responses
    data = response.text
    try:
        parsed_data = json.loads(data)
        result = json.dumps(parsed_data, indent=2)
    except json.JSONDecodeError:
        result = data[:1000]  # Return first 1000 characters if not JSON
except requests.RequestException as e:
    result = f"Error: {str(e)}"

print(f"Python script result for {url}: {result[:100]}...")  # Add this line for debugging
result  # Return the result
    `;

    try {
        const result = await self.pyodide.runPythonAsync(pythonScript);
        console.log("Python script execution result:", result.slice(0, 100));  // Add this line for debugging
        self.postMessage({ url, result });
    } catch (error) {
        console.error("Error in Python script execution:", error);  // Add this line for debugging
        self.postMessage({ url, result: 'Error: ' + error.message });
    }
};
