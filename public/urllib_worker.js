importScripts('https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js');

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
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');
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
import io
import json
from requests.models import Response
import urllib.request
import urllib.response

url = "${url}"

class CustomSession(requests.Session):
    def request(self, method, url, *args, **kwargs):
        try:
            print('Fetching URL:', url)
            headers = kwargs.get('headers', {})
            data = kwargs.get('data', None)
            print('headers', headers)
            print('method', method)
            if data:
                print('data', data)
            response_content = custom_fetch(url, headers, method, data)
            response = Response()
            response._content = response_content.encode(encoding="utf-8")
            response.status_code = 200  # Assuming success
            response.headers['Content-Type'] = 'text/html; charset=utf-8'
            return response
        except Exception as e:
            print(f"CustomSession request error: {e}")
            raise

# Monkey patch urllib.request to use CustomSession
class CustomHTTPResponse(io.BytesIO):
    def __init__(self, response):
        super().__init__(response.content)
        self.response = response

    def geturl(self):
        return self.response.url

    def info(self):
        return self.response.headers

    def getcode(self):
        return self.response.status_code

def custom_urlopen(request, data=None, timeout=None):
    if isinstance(request, urllib.request.Request):
        url = request.full_url
        method = request.get_method()
        headers = dict(request.header_items())
        data = request.data
        if data:
            data = data.decode('utf-8') if isinstance(data, bytes) else data
    else:
        url = request
        method = 'POST' if data else 'GET'
        headers = {}
    custom_session = CustomSession()
    response = custom_session.request(method, url, headers=headers, data=data)
    return CustomHTTPResponse(response)

urllib.request.urlopen = custom_urlopen

def fetch_url(url):
    try:
        with urllib.request.urlopen(url) as response:
            return response.read().decode('utf-8')
    except urllib.error.URLError as e:
        return f"Error: {str(e)}"

fetch_url(url)
`;

    try {
        const result = await self.pyodide.runPythonAsync(pythonScript);
        console.log("Python script execution result:", result.slice(0, 100));
        self.postMessage({ url, result });
    } catch (error) {
        console.error("Error in Python script execution:", error);
        self.postMessage({ url, result: 'Error: ' + error.message });
    }
};
