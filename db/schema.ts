import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const chats = pgTable("chats", {
  id: serial().primaryKey(),
  userId: text("user_id").notNull(),
  title: text().notNull().default("New Chat"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial().primaryKey(),
  chatId: integer("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text().notNull(),
  content: text().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
