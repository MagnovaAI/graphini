import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Purchases are intentionally disabled until a real payment provider (Stripe,
// Lemon Squeezy, ...) is wired up. The previous handler called db.addCredits
// directly with no payment verification, which let any authenticated user
// mint gems for free. Re-enabling this endpoint requires verifying a charge
// (e.g. a Stripe checkout session id) before crediting the account.
//
// PLANS catalog kept colocated for whoever wires the integration:
//   starter:    { gems: 100,  price: 4.99 }
//   pro:        { gems: 500,  price: 19.99 }
//   unlimited:  { gems: 2000, price: 49.99 }

export const POST: RequestHandler = async () => {
  return json(
    { error: 'Purchases are disabled until payment verification is implemented.' },
    { status: 501 }
  );
};
