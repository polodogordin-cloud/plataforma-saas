import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicHeader } from "@/components/public/public-header";
import { ThemeScope } from "@/components/public/themed";
import { ProductRow } from "@/components/public/product-row";
import { TableActionsBar } from "@/components/public/table-actions-bar";
import { CartProvider } from "@/components/public/cart-provider";
import type { PublicMenu, PublicRestaurant, RestaurantTheme } from "@/lib/types";

const restaurant: PublicRestaurant = {
  id: "r1",
  name: "Burger House",
  slug: "burger-house",
  logo_url: null,
  description: "Hambúrguer artesanal",
  city: "Fortaleza",
  state: "CE",
  currency: "BRL",
  status: "published",
  settings: {},
};

const product = {
  id: "p1",
  restaurant_id: "r1",
  category_id: "c1",
  name: "X-Bacon",
  description: "Pão brioche, cheddar e bacon",
  price: 29.9,
  image_url: null,
  is_featured: true,
  position: 0,
};

const menu: PublicMenu = {
  sections: [
    {
      id: "c1",
      restaurant_id: "r1",
      name: "Hambúrgueres",
      description: null,
      image_url: null,
      position: 0,
      products: [product],
    },
  ],
  featured: [product],
  counts: { categories: 1, products: 1 },
};

const darkTheme: RestaurantTheme = {
  preset: "dark",
  primary_color: "#f4b942",
  secondary_color: "#7fd1ae",
  background_color: "#16181d",
  text_color: "#f4f5f7",
  button_color: "#f4b942",
  card_style: "flat",
  button_style: "pill",
  logo_url: null,
  cover_url: null,
};

export function render(theme: RestaurantTheme): string {
  return renderToStaticMarkup(
    React.createElement(
      ThemeScope,
      { theme },
      React.createElement(PublicHeader, {
        restaurant,
        menu,
        timeZone: "America/Fortaleza",
        theme,
      }),
      React.createElement(
        CartProvider,
        { tableToken: "TOKEN1", tableName: "Mesa 04" },
        React.createElement(
          "ul",
          null,
          React.createElement(ProductRow, { product, onSelect: () => {}, theme }),
        ),
        React.createElement(TableActionsBar, {
          onWaiter: () => {},
          onCart: () => {},
          onBill: () => {},
          waiterPending: false,
          billPending: false,
          theme,
        }),
      ),
    ),
  );
}

export { darkTheme };
