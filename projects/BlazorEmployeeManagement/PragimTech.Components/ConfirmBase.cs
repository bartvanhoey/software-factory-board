using System.Threading.Tasks;
using Microsoft.AspNetCore.Components;

namespace PragimTech.Components
{
    public class ConfirmBase : ComponentBase
    {

        [Parameter] public EventCallback<bool> ConfirmationChanged { get; set; }
        [Parameter] public string Title { get; set; } = "Delete Confirmation";
        [Parameter] public string Message { get; set; } = "Are you sure you want to delete?";

        public bool ShowConfirmation { get; set; }
        public void Show()
        {
            ShowConfirmation = true;
            StateHasChanged();
        }


        public async Task OnConfirmationChanged(bool value)
        {
            ShowConfirmation = false;
            await ConfirmationChanged.InvokeAsync(value);
        }
    }
}