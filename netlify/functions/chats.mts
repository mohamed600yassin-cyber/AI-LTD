import type { Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { db } from "../../db/index.js";
import { chats, messages } from "../../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export default async (req: Request, context: Context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const user = await getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers,
    });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  // Parse: /api/chats, /api/chats/:id, /api/chats/:id/message
  const chatIdMatch = path.match(/\/api\/chats\/(\d+)/);
  const chatId = chatIdMatch ? parseInt(chatIdMatch[1]) : null;
  const isMessageRoute = /\/api\/chats\/\d+\/message/.test(path);

  try {
    // GET /api/chats — list all chats for user
    if (req.method === "GET" && !chatId) {
      const userChats = await db
        .select()
        .from(chats)
        .where(eq(chats.userId, user.id))
        .orderBy(desc(chats.updatedAt));
      return new Response(JSON.stringify(userChats), { headers });
    }

    // POST /api/chats — create new chat
    if (req.method === "POST" && !chatId) {
      const [newChat] = await db
        .insert(chats)
        .values({ userId: user.id, title: "New Chat" })
        .returning();
      return new Response(JSON.stringify(newChat), { status: 201, headers });
    }

    // GET /api/chats/:id — get chat + messages
    if (req.method === "GET" && chatId && !isMessageRoute) {
      const [chat] = await db
        .select()
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, user.id)));
      if (!chat) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers,
        });
      }
      const chatMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(messages.createdAt);
      return new Response(
        JSON.stringify({ chat, messages: chatMessages }),
        { headers }
      );
    }

    // DELETE /api/chats/:id — delete chat
    if (req.method === "DELETE" && chatId && !isMessageRoute) {
      await db
        .delete(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, user.id)));
      return new Response(null, { status: 204, headers });
    }

    // POST /api/chats/:id/message — send user message, get AI reply
    if (req.method === "POST" && chatId && isMessageRoute) {
      const { content } = await req.json();
      if (!content?.trim()) {
        return new Response(JSON.stringify({ error: "Content required" }), {
          status: 400,
          headers,
        });
      }

      const [chat] = await db
        .select()
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, user.id)));
      if (!chat) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers,
        });
      }

      // Save user message
      await db
        .insert(messages)
        .values({ chatId, role: "user", content: content.trim() });

      // Load full history for context
      const history = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(messages.createdAt);

      // Get AI response
      const aiResp = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system:
          "You are AI LTD, an intelligent, helpful, and friendly AI assistant. Be concise, clear, and useful. Format responses with markdown when helpful.",
        messages: history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      });

      const aiText =
        aiResp.content[0].type === "text" ? aiResp.content[0].text : "";

      const [aiMessage] = await db
        .insert(messages)
        .values({ chatId, role: "assistant", content: aiText })
        .returning();

      // Update title on first message
      const isFirstMessage = history.length === 1;
      const newTitle = isFirstMessage
        ? content.trim().slice(0, 60) + (content.trim().length > 60 ? "…" : "")
        : chat.title;

      await db
        .update(chats)
        .set({ title: newTitle, updatedAt: new Date() })
        .where(eq(chats.id, chatId));

      return new Response(
        JSON.stringify({ message: aiMessage, title: newTitle }),
        { headers }
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers,
    });
  } catch (err) {
    console.error("Chats API error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers,
    });
  }
};

export const config = {
  path: ["/api/chats", "/api/chats/:id", "/api/chats/:id/message"],
};
