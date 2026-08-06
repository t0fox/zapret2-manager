let before = 1;
/* "quoted" ~ ignored
 * blocked ~ ignored // still in the block comment
 */
let after = ~before; // "comment" ~ ignored
