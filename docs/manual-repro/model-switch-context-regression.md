# Model Switch Context Retention Regression Script

Goal: verify switching models does not reset conversation state, attachments, or context references.

## Preconditions
- Start on desktop in a single chat session.
- Ensure at least two selectable text models are available.
- Keep right panel closed (optional) so only chat flow is tested.

## Steps
1. Open a new chat.
2. Attach one image file in the composer.
3. Send `Q1`: "Describe this image in 3 bullet points and remember it for follow-up questions."
4. Wait for full assistant completion.in
5. Switch to a different model from the model selector.
6. Send `Q2`: "Using the same attached image and your previous answer, give two likely exam questions."
7. Confirm the assistant references both:
   - the same image content
   - the earlier Q1 response context
8. Switch to a third model (or back to the first model if only two are available).
9. Send `Q3`: "Now challenge your own previous exam questions and improve them."
10. Confirm Q3 still references prior turns without asking to re-upload the image.

## Pass Criteria
- No new chat is created during model switch.
- Conversation message history remains continuous.
- Attached image context remains available after each model switch.
- Q2 and Q3 can reference prior turns and image content correctly.

## Fail Signals
- Chat ID changes after selecting a new model.
- Assistant behaves as if conversation started from scratch.
- Assistant asks to re-upload the image despite unchanged chat session.
