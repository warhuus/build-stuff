/**
 * NOT DELIVERED (listed in .deliveryignore). Stand-in for the host app's configured OSDK client.
 * A real `Client` built without network access: construction does no I/O, and every request fails,
 * because both the token provider and the fetch function throw.
 */
import { createClient, type Client } from "@osdk/client";

const STUB_MESSAGE = "src/client.ts is a stand-in; the host app provides the real OSDK client";

function failToken(): Promise<string> {
  return Promise.reject(new Error(STUB_MESSAGE));
}

function failFetch(): Promise<Response> {
  return Promise.reject(new Error(STUB_MESSAGE));
}

/** The stand-in client: typed `Client`; any use rejects with an error. */
export const client: Client = createClient(
  "https://stub.invalid",
  "ri.stub.ontology",
  failToken,
  undefined,
  failFetch,
);

export default client;
