if (crossOriginIsolated) {
    // SharedArrayBuffer is available
} else {
    throw new Error('no SharedArrayBuffer');
}

const requestsWorker = new Worker('requests_worker.js');
const urllibWorker = new Worker('urllib_worker.js');

const urls = [
    "https://tarochi-backend-xai-mainnet.paimastudios.com/dex/tgold/historical_price",
    "https://www.wikipedia.org/"
];

function createResultElement(id, title) {
    const container = document.createElement('div');
    container.innerHTML = `
        <h2>${title}</h2>
        <div id="${id}"></div>
    `;
    document.body.appendChild(container);
    return document.getElementById(id);
}

const resultElements = urls.map((url, index) => 
    createResultElement(`result-${index}`, `Result from ${url}:`)
);

function handleWorkerMessage(event) {
    const { url, result } = event.data;
    const index = urls.indexOf(url);
    if (index !== -1) {
        const resultElement = resultElements[index];
        const preElement = document.createElement('pre');
        preElement.textContent = result;
        preElement.style.background = '#ccc';
        preElement.style.maxHeight = '200px';
        preElement.style.overflow = 'scroll';
        
        
        resultElement.appendChild(preElement);
    }
}

const onmessage = async (event) => {
    if (event.data.type === 'page') {
        const { method, meta: url, headers, body, sharedBuffer } = event.data;
        console.log(`main thread> ${method.toLowerCase()}ing page`, url);
        console.log('main thread> headers: ', headers);

        const syncArray = new Int32Array(sharedBuffer, 0, 1);
        const dataArray = new Uint8Array(sharedBuffer, 4);

        try {
            async function fetchWebpage() {
                const proxyUrl = `/proxy-fetch?url=${encodeURIComponent(url)}`;
                return  await fetch(proxyUrl);
            }

            const response = await fetchWebpage(url);

            if (response.ok) {
                const responseText = await response.text();
                console.log({ responseText });
                const textEncoder = new TextEncoder();
                const encodedData = textEncoder.encode(responseText);
                console.log({ encodedData });

                if (encodedData.length > dataArray.length) {
                    throw new Error('Buffer size insufficient');
                }

                console.log('main thread> success ', encodedData.length, dataArray.length);
                dataArray.set(encodedData);
                syncArray[0] = 1; // Indicate success
                console.log('main thread> Notifying Atomics with success');
                Atomics.notify(syncArray, 0);
            } else {
                throw new Error(`HTTP Error: ${response.status}`);
            }
        } catch (error) {
            let errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`main thread> error ${method.toLowerCase()}ing page`, errorMessage);

            const textEncoder = new TextEncoder();
            const encodedError = textEncoder.encode(errorMessage);

            if (encodedError.length <= dataArray.length) {
                dataArray.set(encodedError);
            } else {
                console.warn('Error message too long to fit in buffer');
            }

            console.log('main thread> Notifying Atomics with error');
            syncArray[0] = -1; // Indicate error
            Atomics.notify(syncArray, 0);
        }
    } else {
        handleWorkerMessage(event);
    }
};

function handleWorkerError(error) {
    console.error(`Worker error:`, error);
    document.getElementById('result').textContent = `An error occurred: ${error.message}`;
}

requestsWorker.onmessage = onmessage;
requestsWorker.onerror = handleWorkerError
urllibWorker.onmessage = onmessage;
urllibWorker.onerror = onerror

// Start the requests
urls.forEach((url, index) => {
        requestsWorker.postMessage({ url });
        urllibWorker.postMessage({ url });
});
