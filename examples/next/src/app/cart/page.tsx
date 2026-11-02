import { Cart } from '@/app/cart.tsx';
import { Header } from '@/app/header.tsx';

// A route of its own: with `split`, its client code brings the cart's messages, and the home page's
// brings none of them.
export default function CartPage() {
  return (
    <main>
      <Header />
      <Cart />
    </main>
  );
}
