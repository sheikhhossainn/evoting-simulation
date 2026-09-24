# @evoting/core-api (P5)

Typed, dependency-free API client for the Expo voter journey. It owns request
serialization, session bearer headers, stable error-envelope parsing, and the
HTTPS-only release configuration boundary.

The client never logs or retains raw NIDs in errors, and its `/vote` method has
no NID parameter: mobile identity comes from the server-issued session. Local
HTTP is accepted only when the caller explicitly opts into localhost
development; release callers must provide an HTTPS base URL.
