import React from 'react';

export default async function ManageBacMockupPage() {
  const token = process.env.MANAGEBAC_API_TOKEN;
  // User's provided base URL, or their specific school domain if they know it.
  const customBaseUrl = process.env.MANAGEBAC_BASE_URL?.replace(/\/+$/, "");

  if (!token) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">ManageBac API Test</h1>
        <div className="bg-red-100 text-red-800 p-4 rounded-md">
          <p><strong>Status:</strong> Not Working</p>
          <p>Missing environment variable: <code>MANAGEBAC_API_TOKEN</code>.</p>
          <p className="mt-2 text-sm">Please update your environment variables and restart the server.</p>
        </div>
      </div>
    );
  }

  // We test a matrix of base URLs to guarantee we find the right one for this school/token.
  const baseUrlsToTest = [
    ...(customBaseUrl ? [customBaseUrl, `${customBaseUrl}/v2`, `${customBaseUrl}/api/v2`] : []),
    'https://api.managebac.com/v2',
    'https://api.managebac.com/v2p2',
    'https://api.managebac.com',
    'https://api.managebac.eu/v2',
    'https://api.us.managebac.com/v2',
    'https://api.managebac.cn/v2',
  ];

  // We deduplicate the list of base URLs
  const uniqueBaseUrls = Array.from(new Set(baseUrlsToTest));

  // A focused list of endpoints to probe across all Base URLs
  const endpointsToTest = [
    '/utilities/ping', // Best for testing auth validity
    '/school',
    '/students',
    '/classes',
  ];

  // Run the matrix: Every Base URL x Every Endpoint
  let allResults = [];
  
  for (const baseUrl of uniqueBaseUrls) {
    for (const endpoint of endpointsToTest) {
      // Ensure we don't end up with //api/v2 if the baseUrl already has it
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const fullUrl = `${baseUrl}${cleanEndpoint}`.replace(/\/v2\/api\/v2/, '/v2');

      try {
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            // API V2 uses auth-token
            'auth-token': token,
            // Fallback for some legacy setups
            'Authorization': `Bearer ${token}`
          },
          cache: 'no-store'
        });

        const status = response.status;
        const ok = response.ok;
        let data = null;
        
        if (ok) {
          data = await response.json();
        } else {
          try {
            data = await response.json();
          } catch (e) {
            data = await response.text();
          }
        }

        allResults.push({ url: fullUrl, ok, status, data });
      } catch (error: any) {
        allResults.push({ url: fullUrl, ok: false, status: 'Fetch Error', data: error.message });
      }
    }
  }

  // Filter down to show the working ones first, but keep a log of everything
  const workingResults = allResults.filter(r => r.ok);
  const failedResults = allResults.filter(r => !r.ok);
  const anyWorking = workingResults.length > 0;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 bg-white min-h-screen text-black">
      <h1 className="text-3xl font-bold border-b pb-4">ManageBac Admin Token Prober</h1>
      
      <div className={`p-4 rounded-md border ${anyWorking ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
        <p className="font-bold text-lg">
          Status: {anyWorking ? '✅ WORKING (Found valid API configuration!)' : '❌ NOT WORKING (No endpoints returned 2xx)'}
        </p>
        <p className="text-sm opacity-80 mt-1">Tested {uniqueBaseUrls.length} different API Base URLs against {endpointsToTest.length} endpoints.</p>
        {anyWorking && (
          <p className="text-sm font-semibold mt-2">
            The correct Base URL for this token appears to be:{' '}
            <span className="bg-white px-2 py-1 rounded border">
              {workingResults[0].url.replace(/\/(utilities\/ping|school|students|classes)$/, '')}
            </span>
          </p>
        )}
      </div>

      {anyWorking && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold mt-8 border-b pb-2 text-green-800">✅ Successful Endpoints</h2>
          {workingResults.map((res, i) => (
            <div key={`success-${i}`} className="border rounded-lg shadow-sm overflow-hidden border-green-200">
              <div className="px-4 py-3 border-b bg-green-50 flex justify-between items-center">
                <h2 className="font-mono font-semibold">{res.url}</h2>
                <span className="px-3 py-1 text-xs rounded-full font-bold bg-green-200 text-green-800">
                  {res.status} OK
                </span>
              </div>
              <div className="p-4 overflow-x-auto bg-gray-50">
                <pre className="text-sm font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                  {typeof res.data === 'object' ? JSON.stringify(res.data, null, 2) : String(res.data)}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-xl font-bold mt-8 border-b pb-2 text-red-800">❌ Failed Attempts (Log)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {failedResults.map((res, i) => (
            <div key={`fail-${i}`} className="border rounded shadow-sm p-3 bg-red-50 border-red-100 text-sm overflow-hidden">
              <p className="font-mono font-semibold truncate mb-1 text-red-900" title={res.url}>{res.url}</p>
              <p className="text-red-700 mb-2"><strong>Status:</strong> {res.status}</p>
              <pre className="text-xs text-red-800 whitespace-pre-wrap truncate max-h-16 opacity-75">
                 {typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data)}
              </pre>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
