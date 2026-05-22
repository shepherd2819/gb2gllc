const MONDAY_API = "https://api.monday.com/v2";

export async function mondayQuery<T = unknown>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`Monday API ${res.status}: ${res.statusText}`);

  const json = await res.json() as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Monday: ${json.errors[0].message}`);
  if (!json.data) throw new Error("Monday: empty response");

  return json.data;
}
