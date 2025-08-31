import { Note } from "../models/noteModel.js";

export function setupNoteSocket(io, noteController) {
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join note room
    socket.on("join-note", async (data) => {
      try {
        console.log("🔧 Received join-note event with data:", data);
        const { noteId, userId } = data;
        console.log(`🔧 Extracted: noteId=${noteId}, userId=${userId}`);

            if (!noteId) {
      socket.emit('error', 'Note ID required');
      return;
    }

        // Check if note exists, create if not
        let note = await noteController.getNoteById(noteId);
        if (!note) {
          console.log(`Creating new note: ${noteId}`);
          note = await noteController.createNoteWithId(
            noteId,
            "",
            null,
            userId
          );
        } else {
          console.log(`📖 Found existing note: ${noteId} with owner: ${note.owner}`);

              // If note exists but has no owner AND user is logged in, claim ownership
      if (!note.owner && userId) {
        console.log(`👑 Claiming ownership of note ${noteId} for user ${userId}`);
        await Note.updateOne({ id: noteId }, { owner: userId });
        note.owner = userId; // Update local object
      }
    }

        // Check if user is owner
        const isOwner =
          note.owner && userId && note.owner.toString() === userId;
        console.log(
          `👤 Ownership: noteOwner=${note.owner}, userId=${userId}, isOwner=${isOwner}`
        );

        // Join the note room
        socket.join(noteId);
        socket.noteId = noteId;
        socket.userId = userId;

        // Send current content with ownership info
        socket.emit("note-content", {
          content: note.content,
          hasPassword: !!note.password_hash,
          isOwner: isOwner,
        });

        console.log(
          `User ${socket.id} joined note: ${noteId} (owner: ${isOwner})`
        );
      } catch (error) {
        console.error("Error joining note:", error);
        socket.emit("error", "Failed to join note");
      }
    });

    // Handle authentication
    socket.on("auth", async (data) => {
      const { noteId, password } = data;

      try {
        const isValid = await noteController.verifyPassword(noteId, password);
        if (isValid) {
          socket.authenticated = true;
          socket.emit("auth-success");
        } else {
          socket.emit("auth-failed");
        }
      } catch (error) {
        socket.emit("auth-failed");
      }
    });

    // Handle content updates
    socket.on("update-content", async (data) => {
      const { noteId, content } = data;

      try {
        // Check if note is protected and user is authenticated
        const note = await noteController.getNoteById(noteId);
        if (note.password_hash && !socket.authenticated) {
          socket.emit("auth-required");
          return;
        }

        // Update in database
        await noteController.updateNoteContent(noteId, content);

        // Broadcast to all users in the room
        socket.to(noteId).emit("content-updated", { content });
      } catch (error) {
        console.error("Error updating content:", error);
        socket.emit("error", "Failed to update content");
      }
    });

    // Handle password changes (broadcast to other users)
    socket.on("password-changed", (data) => {
      const { noteId, hasPassword } = data;
      socket.to(noteId).emit("note-settings-updated", { hasPassword });
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`);
      if (socket.noteId) {
        socket.leave(socket.noteId);
      }
    });
  });
}
