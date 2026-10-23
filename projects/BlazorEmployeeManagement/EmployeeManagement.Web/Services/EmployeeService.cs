using System.Collections.Generic;
using System.Net.Http;
using System.Threading.Tasks;
using EmployeeManagement.Models;
using System.Net.Http.Json;

namespace EmployeeManagement.Web.Services
{
    public class EmployeeService : IEmployeeService
    {
        private readonly HttpClient _httpClient;

        public EmployeeService(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        public async Task<Employee> CreateEmployee(Employee employee)
        {
            var response = await _httpClient.PostAsJsonAsync("api/employees", employee);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<Employee>();
        }

        public async Task DeleteEmployee(int id)
        {
            await _httpClient.DeleteAsync($"api/employees/{id}");
        }

        public async Task<Employee> GetEmployee(int id)
        {
            return await _httpClient.GetFromJsonAsync<Employee>($"api/employees/{id}");
        }


        public async Task<IEnumerable<Employee>> GetEmployees()
        {
            return await _httpClient.GetFromJsonAsync<Employee[]>("api/employees");
        }

        public async Task<Employee> UpdateEmployee(Employee employee)
        {
            var response = await _httpClient.PutAsJsonAsync($"api/employees/{employee.EmployeeId}", employee);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<Employee>();
        }
    }
}