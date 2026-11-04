import type { LoginError } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

interface LoginErrorMessage {
  shop?: string;
}

export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Įveskite parduotuvės adresą" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Įveskite teisingą parduotuvės adresą, pvz., parduotuve.myshopify.com" };
  }

  return {};
}
