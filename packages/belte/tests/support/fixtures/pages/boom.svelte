<script lang="ts">
// Characterizes the render-throw path: error.svelte wins with a 500.
throw new Error('boom render')
</script>

<p>never rendered</p>
