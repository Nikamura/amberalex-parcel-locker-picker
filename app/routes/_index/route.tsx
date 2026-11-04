import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const meta: MetaFunction = () => [{ title: "Paštomatai" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Paštomatai</h1>
        <p className={styles.text}>
          Paštomato pasirinkimas Shopify parduotuvei ir Alsendo siuntų kūrimas vienoje vietoje.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Parduotuvės adresas</span>
              <input className={styles.input} type="text" name="shop" placeholder="parduotuve.myshopify.com" />
            </label>
            <button className={styles.button} type="submit">
              Prisijungti
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Krepšelyje ir atsiskaitant.</strong> Pirkėjas pasirenka DPD, Omniva, Venipak ar SmartPosti
            paštomatą žemėlapyje dar prieš apmokėdamas.
          </li>
          <li>
            <strong>Po apmokėjimo.</strong> Jei paštomatas dar nepasirinktas, padėkos puslapis jo paprašo.
          </li>
          <li>
            <strong>Alsendo siuntos.</strong> Siunta į pasirinktą paštomatą sukuriama automatiškai, o atšaukus užsakymą
            – atšaukiama.
          </li>
        </ul>
      </div>
    </div>
  );
}
