import { healthPayload } from "../../../src/health";

export function GET() {
  return Response.json(healthPayload());
}
