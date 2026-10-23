using Microsoft.AspNetCore.Components;

namespace EmployeeManagement.Web.Pages
{
    public class DataBindingDemoBase : ComponentBase
    {
        protected string Name { get; set; }  = "Tom";
        protected string Gender { get; set; }  = "Male";

        protected string Colour {get; set;} = "background-color:white";


        public string Description { get; set; } = string.Empty;
    }

}