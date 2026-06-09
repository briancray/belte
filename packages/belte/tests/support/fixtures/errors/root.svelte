<script lang="ts">
let { status, message }: { status: number; message: string } = $props()
</script>

<p data-error>{status}:{message}</p>
